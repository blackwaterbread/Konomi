-- CreateIndex
CREATE INDEX "Image_folderId_fileModifiedAt_id_idx" ON "Image"("folderId", "fileModifiedAt", "id");

-- CreateIndex
CREATE INDEX "Image_folderId_isFavorite_fileModifiedAt_id_idx" ON "Image"("folderId", "isFavorite", "fileModifiedAt", "id");

-- CreateIndex
CREATE INDEX "Image_folderId_path_id_idx" ON "Image"("folderId", "path", "id");
