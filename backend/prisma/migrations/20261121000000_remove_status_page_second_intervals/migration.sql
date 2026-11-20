-- Remove the public status page feature.
DROP TABLE "StatusPage";

-- Store check intervals in seconds (5, 10, 30, 60, 300, 600).
-- Existing monitors keep their schedule: minutes are converted to seconds.
ALTER TABLE "Monitor" ADD COLUMN "intervalSeconds" INTEGER;
UPDATE "Monitor" SET "intervalSeconds" = "intervalMinutes" * 60;
ALTER TABLE "Monitor" ALTER COLUMN "intervalSeconds" SET NOT NULL;
ALTER TABLE "Monitor" DROP COLUMN "intervalMinutes";
