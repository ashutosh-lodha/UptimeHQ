-- Sign-in moves to Clerk. Existing users keep their data: on first Clerk
-- sign-in they are linked by verified email (see middleware/auth.ts).
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT;
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- Passwords are no longer stored by UptimeHQ.
ALTER TABLE "User" DROP COLUMN "passwordHash";
