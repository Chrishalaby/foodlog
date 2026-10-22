import type { AuthStatusResponse } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  setupAndLogin,
  withSettings,
} from './helpers.js';

describe('notes turned off (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      configure: withSettings({ notesEnabled: false }),
    });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it('hides the notes API and says so in the auth status', async () => {
    const agent = await setupAndLogin(app);
    const status = (await agent.get('/api/auth/status').expect(200))
      .body as AuthStatusResponse;
    expect(status).not.toHaveProperty('notes');
    const listed = await agent.get('/api/notes').expect(404);
    expect(listed.body.message).toBe('Notes are not enabled on this server');
    await agent.post('/api/notes').send({ text: 'Buy mirror' }).expect(404);
  });
});
