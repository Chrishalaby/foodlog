CREATE TABLE "AiProviderConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "provider" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiStyle" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "preciseModel" TEXT NOT NULL,
    "apiKeySealed" TEXT,
    "apiKeyLast4" TEXT,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "transcribeBaseUrl" TEXT,
    "transcribeModel" TEXT,
    "transcribeApiKeySealed" TEXT,
    "transcribeApiKeyLast4" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiProviderConfig_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiProviderConfig_singleton" CHECK ("id" = 'default')
);
