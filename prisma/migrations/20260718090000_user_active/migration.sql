-- Deactivatable users: hidden from assignee pickers without touching their data.

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
