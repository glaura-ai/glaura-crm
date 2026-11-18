CREATE TABLE "OutreachSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoStart" BOOLEAN NOT NULL DEFAULT false,
    "step0Text" TEXT NOT NULL,
    "step1Text" TEXT NOT NULL,
    "askPhoneText" TEXT NOT NULL,
    "step1DelayHours" INTEGER NOT NULL DEFAULT 20,
    "step2DelayDays" INTEGER NOT NULL DEFAULT 2,
    "step3DelayDays" INTEGER NOT NULL DEFAULT 5,
    "sendHourStart" INTEGER NOT NULL DEFAULT 9,
    "sendHourEnd" INTEGER NOT NULL DEFAULT 20,
    "template1" TEXT NOT NULL DEFAULT 'glaura_demo_invite',
    "template2" TEXT NOT NULL DEFAULT 'glaura_demo_last_call',
    "templateLang" TEXT NOT NULL DEFAULT 'fr',
    "calendarUrl" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutreachSettings_pkey" PRIMARY KEY ("id")
);
