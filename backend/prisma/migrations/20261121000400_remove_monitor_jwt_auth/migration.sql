-- Remove the "Signed JWT" monitor authentication method.
-- Any monitor still using it falls back to no authentication (its stored
-- credentials are cleared); in practice none existed when this was written.
UPDATE "Monitor"
SET "authType" = 'NONE', "encryptedAuthConfig" = NULL, "authConfigVersion" = "authConfigVersion" + 1
WHERE "authType" = 'JWT';

-- PostgreSQL cannot drop an enum value, so the type is recreated without it.
ALTER TYPE "MonitorAuthType" RENAME TO "MonitorAuthType_old";
CREATE TYPE "MonitorAuthType" AS ENUM ('NONE', 'BEARER', 'BASIC', 'API_KEY', 'CUSTOM_HEADERS', 'OAUTH2_CLIENT_CREDENTIALS');
ALTER TABLE "Monitor" ALTER COLUMN "authType" DROP DEFAULT;
ALTER TABLE "Monitor" ALTER COLUMN "authType" TYPE "MonitorAuthType" USING ("authType"::text::"MonitorAuthType");
ALTER TABLE "Monitor" ALTER COLUMN "authType" SET DEFAULT 'NONE';
DROP TYPE "MonitorAuthType_old";
