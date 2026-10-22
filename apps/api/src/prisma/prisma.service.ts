import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfig } from '../config/app-config.js';
import { PrismaClient } from '../generated/prisma/client.js';

function createAdapter(databaseUrl: string): PrismaPg {
  const schema = new URL(databaseUrl).searchParams.get('schema') ?? undefined;
  return new PrismaPg({ connectionString: databaseUrl }, { schema });
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor(config: AppConfig) {
    super({ adapter: createAdapter(config.databaseUrl) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
