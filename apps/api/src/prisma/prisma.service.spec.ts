import { AppConfig } from '../config/app-config.js';
import { parseSettings } from '../config/settings.js';
import { PrismaService } from './prisma.service.js';

const DATABASE_URL = 'postgresql://food:food@localhost:5433/food?schema=public';

describe('PrismaService', () => {
  function createService(): PrismaService {
    return new PrismaService(new AppConfig(parseSettings({ DATABASE_URL })));
  }

  it('keeps the connection open while modules are destroyed', () => {
    const service = createService();

    expect('onModuleDestroy' in service).toBe(false);
  });

  it('disconnects once when the application shuts down', async () => {
    const service = createService();
    const disconnect = vi
      .spyOn(service, '$disconnect')
      .mockResolvedValue(undefined);

    await service.onApplicationShutdown();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
