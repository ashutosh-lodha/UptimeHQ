-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'HEAD');

-- CreateEnum
CREATE TYPE "MonitorStatus" AS ENUM ('PENDING', 'UP', 'DOWN');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DOWN', 'RECOVERY');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Monitor" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" "HttpMethod" NOT NULL DEFAULT 'GET',
    "intervalMinutes" INTEGER NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "expectedStatusMin" INTEGER NOT NULL DEFAULT 200,
    "expectedStatusMax" INTEGER NOT NULL DEFAULT 399,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "MonitorStatus" NOT NULL DEFAULT 'PENDING',
    "lastCheckedAt" TIMESTAMPTZ(3),
    "lastResponseTimeMs" INTEGER,
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Monitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorCheck" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "statusCode" INTEGER,
    "responseTimeMs" INTEGER,
    "error" TEXT,

    CONSTRAINT "MonitorCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "durationMs" INTEGER,
    "cause" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT NOT NULL,
    "notifyOnDown" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnRecovery" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusPage" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StatusPage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Monitor_userId_createdAt_idx" ON "Monitor"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Monitor_enabled_idx" ON "Monitor"("enabled");

-- CreateIndex
CREATE INDEX "MonitorCheck_monitorId_checkedAt_idx" ON "MonitorCheck"("monitorId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "MonitorCheck_checkedAt_idx" ON "MonitorCheck"("checkedAt");

-- CreateIndex
CREATE INDEX "Incident_monitorId_startedAt_idx" ON "Incident"("monitorId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "Incident_resolvedAt_idx" ON "Incident"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_userId_key" ON "NotificationSetting"("userId");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_idx" ON "NotificationDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_incidentId_type_key" ON "NotificationDelivery"("incidentId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_userId_key" ON "StatusPage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusPage_slug_key" ON "StatusPage"("slug");

-- AddForeignKey
ALTER TABLE "Monitor" ADD CONSTRAINT "Monitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonitorCheck" ADD CONSTRAINT "MonitorCheck_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusPage" ADD CONSTRAINT "StatusPage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- At most one open (unresolved) incident per monitor.
CREATE UNIQUE INDEX "Incident_one_open_per_monitor" ON "Incident"("monitorId") WHERE "resolvedAt" IS NULL;
