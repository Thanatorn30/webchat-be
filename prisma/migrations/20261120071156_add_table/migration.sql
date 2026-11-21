-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'agent');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('open', 'pending', 'closed');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('in', 'out');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'image', 'video', 'audio', 'file', 'sticker', 'location');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('pending', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('queued', 'sent', 'failed');

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'agent',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "line_user_id" VARCHAR(64) NOT NULL,
    "display_name" VARCHAR(255),
    "picture_url" TEXT,
    "is_following" BOOLEAN NOT NULL DEFAULT true,
    "followed_at" TIMESTAMPTZ,
    "unfollowed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'open',
    "assigned_admin_id" UUID,
    "last_message_at" TIMESTAMPTZ,
    "last_message_preview" VARCHAR(255),
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_admin_id" UUID,
    "type" "MessageType" NOT NULL,
    "text" TEXT,
    "payload" JSONB,
    "media_path" TEXT,
    "media_mime" VARCHAR(100),
    "media_status" "MediaStatus",
    "line_message_id" VARCHAR(64),
    "webhook_event_id" VARCHAR(64),
    "retry_key" UUID,
    "send_status" "SendStatus",
    "send_error" TEXT,
    "is_unsent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "webhook_event_id" VARCHAR(64) NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "is_redelivery" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ,
    "error" TEXT,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("webhook_event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_line_user_id_key" ON "contacts"("line_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contact_id_key" ON "conversations"("contact_id");

-- CreateIndex
CREATE INDEX "conversations_status_last_message_at_idx" ON "conversations"("status", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "messages_webhook_event_id_key" ON "messages"("webhook_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_retry_key_key" ON "messages"("retry_key");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "messages_line_message_id_idx" ON "messages"("line_message_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_admin_id_fkey" FOREIGN KEY ("assigned_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_admin_id_fkey" FOREIGN KEY ("sender_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
