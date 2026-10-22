UPDATE "User" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "User" WHERE "role" = 'admin');
