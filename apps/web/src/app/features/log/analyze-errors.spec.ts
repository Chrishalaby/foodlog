import { HttpErrorResponse } from '@angular/common/http';
import { ImageDecodeError } from '../../shared/utils/image-compress';
import { describeAnalyzeError } from './analyze-errors';

const httpError = (status: number, message?: string): HttpErrorResponse =>
  new HttpErrorResponse({
    status,
    error: message === undefined ? null : { statusCode: status, message },
  });

describe('describeAnalyzeError', () => {
  it('treats status 0 as offline and retryable', () => {
    expect(describeAnalyzeError(httpError(0))).toMatchObject({
      kind: 'offline',
      retryable: true,
    });
  });

  it('separates the monthly budget from the rate limit', () => {
    expect(describeAnalyzeError(httpError(429, 'Monthly AI budget reached'))).toMatchObject({
      kind: 'budget',
      retryable: false,
    });
    const rate = describeAnalyzeError(httpError(429, 'ThrottlerException: Too Many Requests'));
    expect(rate).toMatchObject({ kind: 'rate_limited', retryable: true });
    expect(rate.message).toContain('Wait a minute');
    expect(
      describeAnalyzeError(
        httpError(429, 'OpenAI is rate limiting requests — try again in a minute'),
      ),
    ).toMatchObject({ kind: 'rate_limited', retryable: true });
  });

  describe('when your own monthly AI budget is used up', () => {
    const ownBudget = (): HttpErrorResponse => httpError(429, 'Your monthly AI budget is used up');

    it('tells a member to ask the admin and log without AI, never about server settings', () => {
      const failure = describeAnalyzeError(ownBudget());
      expect(failure).toMatchObject({
        kind: 'budget',
        retryable: false,
        title: "You've used this month's AI budget",
      });
      expect(failure.message).toContain('Ask your admin');
      expect(failure.message).toContain('1st (UTC)');
      expect(failure.message).toContain('scan a barcode');
      expect(failure.message).not.toContain('AI_MONTHLY_BUDGET_USD');
      expect(failure.message).not.toContain('used up.');
    });

    it('points an admin to the admin panel, not the global cap', () => {
      const failure = describeAnalyzeError(ownBudget(), { admin: true });
      expect(failure).toMatchObject({ kind: 'budget', retryable: false });
      expect(failure.message).toContain('Admin → People');
      expect(failure.message).not.toContain('AI_MONTHLY_BUDGET_USD');
    });
  });

  describe('when the app-wide monthly AI budget is reached', () => {
    const globalCap = (): HttpErrorResponse => httpError(429, 'Monthly AI budget reached');

    it('keeps server settings out of the message for members', () => {
      const failure = describeAnalyzeError(globalCap());
      expect(failure).toMatchObject({
        kind: 'budget',
        retryable: false,
        title: 'AI paused for this month',
      });
      expect(failure.message).toContain('Ask your admin');
      expect(failure.message).not.toContain('AI_MONTHLY_BUDGET_USD');
      expect(failure.message).not.toContain(failure.title);
    });

    it('names the server setting for admins', () => {
      const failure = describeAnalyzeError(globalCap(), { admin: true });
      expect(failure).toMatchObject({
        kind: 'budget',
        retryable: false,
        title: 'Monthly AI budget reached',
      });
      expect(failure.message).toContain('AI_MONTHLY_BUDGET_USD');
      expect(failure.message).not.toContain(failure.title);
    });
  });

  it('explains how to configure the API key to admins when AI is not configured', () => {
    const failure = describeAnalyzeError(
      httpError(503, 'AI is not configured — an admin can add a provider in Settings → AI'),
      {
        admin: true,
      },
    );
    expect(failure).toMatchObject({ kind: 'not_configured', retryable: false });
    expect(failure.message).toContain('Settings → AI');
    expect(describeAnalyzeError(httpError(503))).toMatchObject({
      kind: 'ai_unavailable',
      retryable: true,
    });
  });

  it('keeps server settings from members when AI is not configured', () => {
    const failure = describeAnalyzeError(
      httpError(503, 'AI is not configured — an admin can add a provider in Settings → AI'),
    );
    expect(failure).toMatchObject({ kind: 'not_configured', retryable: false });
    expect(failure.message).not.toContain('Settings → AI');
    expect(failure.message).toContain('Ask your admin');
  });

  it('offers a retry for upstream AI failures and timeouts', () => {
    expect(describeAnalyzeError(httpError(502, 'AI analysis failed'))).toMatchObject({
      kind: 'ai_failed',
      retryable: true,
    });
    const timeout = describeAnalyzeError(httpError(504));
    expect(timeout.kind).toBe('ai_failed');
    expect(timeout.title).toBe('The AI took too long');
    expect(timeout.message).toContain('kept');
  });

  it('passes on what the server says went wrong with the AI', () => {
    const refusal = describeAnalyzeError(
      httpError(502, 'The AI declined to analyze this — try another photo or add a description'),
    );
    expect(refusal).toMatchObject({ kind: 'ai_failed', retryable: true });
    expect(refusal.message).toContain('try another photo or add a description');
    expect(refusal.message).toContain('kept');

    const quota = describeAnalyzeError(httpError(503, 'OpenAI quota or billing limit reached'));
    expect(quota).toMatchObject({ kind: 'ai_unavailable', retryable: true });
    expect(quota.message).toContain('OpenAI quota or billing limit reached.');
  });

  it('explains that an expired analysis cannot be updated', () => {
    expect(describeAnalyzeError(httpError(404, 'Previous analysis not found'))).toMatchObject({
      kind: 'expired',
      retryable: false,
    });
    expect(describeAnalyzeError(httpError(404))).toMatchObject({ kind: 'unknown' });
  });

  it('flags uploads that are too large', () => {
    expect(describeAnalyzeError(httpError(413))).toMatchObject({
      kind: 'too_large',
      retryable: false,
    });
  });

  it('surfaces validation messages from the server', () => {
    const failure = describeAnalyzeError(httpError(400, 'description should not be empty'));
    expect(failure).toMatchObject({ kind: 'rejected', retryable: false });
    expect(failure.message).toBe('Description should not be empty.');
  });

  it('explains undecodable images such as HEIC on desktop', () => {
    const failure = describeAnalyzeError(
      new ImageDecodeError(new Blob([], { type: 'image/heic' }), new Error('decode')),
    );
    expect(failure).toMatchObject({ kind: 'unreadable_image', retryable: false });
    expect(failure.message).toContain('HEIC');
  });

  it('falls back to the error message for unknown failures', () => {
    expect(describeAnalyzeError(new Error('Boom'))).toMatchObject({
      kind: 'unknown',
      message: 'Boom',
      retryable: true,
    });
  });
});
