-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_assigned_admin_id_fkey";

-- DropIndex
DROP INDEX "conversations_status_last_message_at_idx";

-- DropIndex
DROP INDEX "messages_line_message_id_idx";

-- AlterTable
ALTER TABLE "contacts" DROP COLUMN "followed_at",
DROP COLUMN "unfollowed_at";

-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "assigned_admin_id",
DROP COLUMN "status",
DROP COLUMN "unread_count";

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "is_unsent",
DROP COLUMN "media_mime",
DROP COLUMN "media_path",
DROP COLUMN "media_status";

-- DropEnum
DROP TYPE "ConversationStatus";

-- DropEnum
DROP TYPE "MediaStatus";

-- DropTable
DROP TABLE "webhook_events";
