CREATE TABLE "InstagramSync" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "stage" TEXT,
  "metaConversations" INTEGER NOT NULL DEFAULT 0,
  "metaMessages" INTEGER NOT NULL DEFAULT 0,
  "firebaseThreads" INTEGER NOT NULL DEFAULT 0,
  "firebaseMessages" INTEGER NOT NULL DEFAULT 0,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "heartbeatAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "InstagramSync_pkey" PRIMARY KEY ("id")
);
