/*
  Warnings:

  - You are about to drop the column `price` on the `Toy` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "EventItem" ADD COLUMN     "price" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Toy" DROP COLUMN "price";
