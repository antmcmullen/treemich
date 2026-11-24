-- CreateTable
CREATE TABLE "OidcIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OidcIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OidcIdentity_issuer_subject_key" ON "OidcIdentity"("issuer", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "OidcIdentity_userId_issuer_key" ON "OidcIdentity"("userId", "issuer");

-- AddForeignKey
ALTER TABLE "OidcIdentity" ADD CONSTRAINT "OidcIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "TreemichUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

