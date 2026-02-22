-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BundleComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "productImage" TEXT,
    "price" TEXT NOT NULL DEFAULT '0',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BundleComponent_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_BundleComponent" ("bundleId", "createdAt", "id", "productId", "productImage", "productTitle", "quantity", "sortOrder", "updatedAt", "variantId", "variantTitle") SELECT "bundleId", "createdAt", "id", "productId", "productImage", "productTitle", "quantity", "sortOrder", "updatedAt", "variantId", "variantTitle" FROM "BundleComponent";
DROP TABLE "BundleComponent";
ALTER TABLE "new_BundleComponent" RENAME TO "BundleComponent";
CREATE INDEX "BundleComponent_bundleId_idx" ON "BundleComponent"("bundleId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
