import type {
  AiSettings,
  AppSettings,
  CatalogSettings,
  DemoSettings,
  NodeEnv,
  StorageSettings,
} from './settings.js';

export class AppConfig implements AppSettings {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  readonly cookieSecure: boolean;
  readonly jwtSecret: string | null;
  readonly setupCode: string | null;
  readonly adminEmails: readonly string[];
  readonly appUrl: string | null;
  readonly webDistDir: string;
  readonly ai: Readonly<AiSettings>;
  readonly storage: Readonly<StorageSettings>;
  readonly catalog: Readonly<CatalogSettings>;
  readonly demo: Readonly<DemoSettings>;
  readonly notesEnabled: boolean;

  constructor(settings: AppSettings) {
    this.nodeEnv = settings.nodeEnv;
    this.isProduction = settings.isProduction;
    this.port = settings.port;
    this.host = settings.host;
    this.databaseUrl = settings.databaseUrl;
    this.cookieSecure = settings.cookieSecure;
    this.jwtSecret = settings.jwtSecret;
    this.setupCode = settings.setupCode;
    this.adminEmails = Object.freeze([...settings.adminEmails]);
    this.appUrl = settings.appUrl;
    this.webDistDir = settings.webDistDir;
    this.ai = Object.freeze({ ...settings.ai });
    this.storage = Object.freeze({ ...settings.storage });
    this.catalog = Object.freeze({ ...settings.catalog });
    this.demo = Object.freeze({ ...settings.demo });
    this.notesEnabled = settings.notesEnabled;
  }

  isAdminEmail(email: string): boolean {
    return this.adminEmails.includes(email.trim().toLowerCase());
  }
}
