import { HttpErrorResponse } from '@angular/common/http';
import { apiErrorMessage, errorMessage } from '../../core/errors';
import { ImageDecodeError } from '../../shared/utils/image-compress';

export type AnalyzeFailureKind =
  | 'offline'
  | 'rate_limited'
  | 'budget'
  | 'not_configured'
  | 'ai_unavailable'
  | 'ai_failed'
  | 'too_large'
  | 'unreadable_image'
  | 'rejected'
  | 'expired'
  | 'unknown';

export interface AnalyzeFailure {
  kind: AnalyzeFailureKind;
  title: string;
  message: string;
  retryable: boolean;
}

export interface AnalyzeViewer {
  admin: boolean;
}

const MEMBER: AnalyzeViewer = { admin: false };

const KEPT = 'Everything you entered is kept.';
const NO_AI = 'Until then, log from your foods, scan a barcode or enter it manually. No AI needed.';

export function offlineFailure(): AnalyzeFailure {
  return {
    kind: 'offline',
    title: "You're offline",
    message: `Analysis needs a connection. ${KEPT} Try again once you're back online.`,
    retryable: true,
  };
}

function unreadableImage(): AnalyzeFailure {
  return {
    kind: 'unreadable_image',
    title: "Can't read this photo",
    message:
      "This image format isn't supported on this device (HEIC photos often aren't on desktop). Take a new photo or pick a JPEG or PNG.",
    retryable: false,
  };
}

function ownBudgetUsedUp(viewer: AnalyzeViewer): AnalyzeFailure {
  return {
    kind: 'budget',
    title: "You've used this month's AI budget",
    message: viewer.admin
      ? `Raise your own limit under Admin → People. ${NO_AI}`
      : `Ask your admin to raise your limit. It resets on the 1st (UTC). ${NO_AI}`,
    retryable: false,
  };
}

function sharedBudgetUsedUp(viewer: AnalyzeViewer): AnalyzeFailure {
  return viewer.admin
    ? {
        kind: 'budget',
        title: 'Monthly AI budget reached',
        message: `FoodLog's app-wide AI budget is used up. Raise AI_MONTHLY_BUDGET_USD on the server. ${NO_AI}`,
        retryable: false,
      }
    : {
        kind: 'budget',
        title: 'AI paused for this month',
        message: `FoodLog's shared AI budget for this month is used up. Ask your admin, or wait until it resets on the 1st (UTC). ${NO_AI}`,
        retryable: false,
      };
}

function rateLimited(serverMessage: string | null, viewer: AnalyzeViewer): AnalyzeFailure {
  if (serverMessage && /budget/i.test(serverMessage)) {
    return /your monthly ai budget|used up/i.test(serverMessage)
      ? ownBudgetUsedUp(viewer)
      : sharedBudgetUsedUp(viewer);
  }
  return {
    kind: 'rate_limited',
    title: 'Too many analyses',
    message: `You've hit the AI rate limit. Wait a minute, then try again. ${KEPT}`,
    retryable: true,
  };
}

function notConfigured(viewer: AnalyzeViewer): AnalyzeFailure {
  return viewer.admin
    ? {
        kind: 'not_configured',
        title: 'AI is not set up',
        message:
          'The server has no OpenAI API key. Set OPENAI_API_KEY (or AI_PROVIDER=mock for testing) and restart the API. You can still log this meal manually.',
        retryable: false,
      }
    : {
        kind: 'not_configured',
        title: 'AI analysis is unavailable',
        message: `AI analysis isn't set up on the server yet. Ask your admin. ${NO_AI}`,
        retryable: false,
      };
}

function unavailable(serverMessage: string | null, viewer: AnalyzeViewer): AnalyzeFailure {
  if (serverMessage && /not configured/i.test(serverMessage)) {
    return notConfigured(viewer);
  }
  return {
    kind: 'ai_unavailable',
    title: 'AI temporarily unavailable',
    message: serverMessage
      ? `${serverMessage} ${KEPT} Try again later, or log this meal manually.`
      : `The analysis service is not responding right now. ${KEPT} Try again in a moment.`,
    retryable: true,
  };
}

function aiFailed(status: number, serverMessage: string | null): AnalyzeFailure {
  return {
    kind: 'ai_failed',
    title: status === 504 ? 'The AI took too long' : "The AI couldn't finish",
    message: serverMessage
      ? `${serverMessage} ${KEPT}`
      : `${KEPT} Try again, it usually works on the next attempt.`,
    retryable: true,
  };
}

function expired(): AnalyzeFailure {
  return {
    kind: 'expired',
    title: 'This analysis has expired',
    message:
      "The earlier analysis is no longer on the server, so it can't be updated. Save the meal as it is, or start a new analysis.",
    retryable: false,
  };
}

function describeHttpError(err: HttpErrorResponse, viewer: AnalyzeViewer): AnalyzeFailure {
  const serverMessage = apiErrorMessage(err.error);
  switch (err.status) {
    case 0:
      return offlineFailure();
    case 413:
      return {
        kind: 'too_large',
        title: 'Photo too large',
        message: 'The photo is larger than the server accepts. Try a different or smaller photo.',
        retryable: false,
      };
    case 429:
      return rateLimited(serverMessage, viewer);
    case 503:
      return unavailable(serverMessage, viewer);
    case 502:
    case 504:
      return aiFailed(err.status, serverMessage);
    case 400:
    case 422:
      return {
        kind: 'rejected',
        title: "Couldn't analyze this",
        message: serverMessage ?? 'The request was not accepted. Check the photo and description.',
        retryable: false,
      };
    default:
      if (err.status === 404 && serverMessage && /previous analysis/i.test(serverMessage)) {
        return expired();
      }
      if (err.status >= 500) {
        return aiFailed(err.status, null);
      }
      return {
        kind: 'unknown',
        title: 'Analysis failed',
        message: errorMessage(err),
        retryable: true,
      };
  }
}

export function describeAnalyzeError(err: unknown, viewer: AnalyzeViewer = MEMBER): AnalyzeFailure {
  if (err instanceof ImageDecodeError) {
    return unreadableImage();
  }
  if (err instanceof HttpErrorResponse) {
    return describeHttpError(err, viewer);
  }
  return {
    kind: 'unknown',
    title: 'Analysis failed',
    message: errorMessage(err),
    retryable: true,
  };
}
