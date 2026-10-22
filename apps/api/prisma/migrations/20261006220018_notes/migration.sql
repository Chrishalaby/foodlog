CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotePhoto" (
    "noteId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "NotePhoto_pkey" PRIMARY KEY ("noteId","photoId")
);

CREATE INDEX "Note_userId_createdAt_idx" ON "Note"("userId", "createdAt");

CREATE INDEX "NotePhoto_photoId_idx" ON "NotePhoto"("photoId");

CREATE UNIQUE INDEX "NotePhoto_noteId_position_key" ON "NotePhoto"("noteId", "position");

ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotePhoto" ADD CONSTRAINT "NotePhoto_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NotePhoto" ADD CONSTRAINT "NotePhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
