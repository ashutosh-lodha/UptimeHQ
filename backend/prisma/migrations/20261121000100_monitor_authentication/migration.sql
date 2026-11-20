-- Authenticated endpoint monitoring. Backward compatible: every existing
-- monitor becomes authType = NONE with no stored credentials.
CREATE TYPE "MonitorAuthType" AS ENUM ('NONE', 'BEARER', 'BASIC', 'API_KEY', 'CUSTOM_HEADERS', 'OAUTH2_CLIENT_CREDENTIALS');

ALTER TABLE "Monitor"
  ADD COLUMN "authType" "MonitorAuthType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "encryptedAuthConfig" TEXT,
  ADD COLUMN "authConfigVersion" INTEGER NOT NULL DEFAULT 1;

-- Classified result of each check. Historical rows are backfilled from
-- the data already recorded, so check history stays intact.
CREATE TYPE "CheckOutcome" AS ENUM ('SUCCESS', 'AUTHENTICATION_FAILED', 'AUTHORIZATION_FAILED', 'TOKEN_ACQUISITION_FAILED', 'NETWORK_ERROR', 'TIMEOUT', 'HTTP_STATUS_FAILURE');

ALTER TABLE "MonitorCheck" ADD COLUMN "outcome" "CheckOutcome";
UPDATE "MonitorCheck" SET "outcome" = CASE
  WHEN "success" THEN 'SUCCESS'::"CheckOutcome"
  WHEN "statusCode" = 401 THEN 'AUTHENTICATION_FAILED'::"CheckOutcome"
  WHEN "statusCode" = 403 THEN 'AUTHORIZATION_FAILED'::"CheckOutcome"
  WHEN "statusCode" IS NOT NULL THEN 'HTTP_STATUS_FAILURE'::"CheckOutcome"
  WHEN "error" LIKE 'Request timed out%' OR "error" = 'Connection timed out' THEN 'TIMEOUT'::"CheckOutcome"
  ELSE 'NETWORK_ERROR'::"CheckOutcome"
END;
ALTER TABLE "MonitorCheck" ALTER COLUMN "outcome" SET NOT NULL;
