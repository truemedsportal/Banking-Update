/**
 * ============================================================
 * TRUE MEDS - RTO & REATTEMPT PORTAL
 * File      : FileUpload.gs
 * Purpose   : Google Drive Upload Manager
 * Version   : 1.0
 * ============================================================
 */

const FileUpload = (() => {

  /**
   * ============================================================
   * UPLOAD FILE
   * ============================================================
   */

  function upload(file, folderUrl) {

    if (!file)
      return Utility.error(ERROR.FILE_REQUIRED);

    const validation =
      Validation.fileSize(file.getBytes().length);

    if (!validation.success)
      return validation;

    const mime =
      Validation.mimeType(file.getContentType());

    if (!mime.success)
      return mime;

    const folder =
      getFolder(folderUrl);

    if (!folder)
      return Utility.error(
        ERROR.INVALID_FOLDER
      );

    const uploaded =
      folder.createFile(file);

    return Utility.success(

      SUCCESS.FILE_UPLOADED,

      {

        fileId:
          uploaded.getId(),

        fileName:
          uploaded.getName(),

        fileUrl:
          uploaded.getUrl(),

        mimeType:
          uploaded.getMimeType(),

        size:
          uploaded.getSize()

      }

    );

  }

  /**
   * Converts a browser data URL into an Apps Script Blob before uploading it.
   * The upload folder is read from Configuration -> UPLOAD_FOLDER_URL.
   */
  function contentTypeFromName(fileName) {

    const extension = Utility.safeString(fileName)
      .toLowerCase()
      .match(/\.([a-z0-9]+)$/);

    const map = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
      heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
      mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac",
      m4a: "audio/mp4", ogg: "audio/ogg", amr: "audio/amr",
      mp4: "video/mp4", mov: "video/quicktime", avi: "video/x-msvideo",
      mkv: "video/x-matroska", webm: "video/webm", "3gp": "video/3gpp",
      "3gpp": "video/3gpp"
    };

    return extension && map[extension[1]] ? map[extension[1]] : "";

  }

  function normaliseContentType(contentType, fileName) {

    const aliases = {
      "image/pjpeg": "image/jpeg",
      "image/x-png": "image/png",
      "audio/x-m4a": "audio/mp4",
      "audio/mpeg3": "audio/mpeg",
      "video/x-m4v": "video/mp4",
      "application/x-pdf": "application/pdf"
    };

    const type = Utility.safeString(contentType).toLowerCase();

    if (!type || type === "application/octet-stream")
      return contentTypeFromName(fileName);

    return aliases[type] || type;

  }

  function uploadBase64(dataUrl, fileName, folderName) {

    const allowedFolders = ["Mandatory Proofs", "Optional Proofs"];
    const safeFolderName = Utility.safeString(folderName);
    const safeName = Utility.safeString(fileName)
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
      .slice(0, 150) || "upload";

    if (allowedFolders.indexOf(safeFolderName) === -1)
      return Utility.error(ERROR.INVALID_FOLDER);

    try {

      const match = Utility.safeString(dataUrl).match(
        /^data:([^;,]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i
      );

      if (!match)
        return Utility.error(ERROR.INVALID_FILE_TYPE);

      const contentType = normaliseContentType(match[1], safeName);
      const base64 = match[2].replace(/\s/g, "");

      if (!contentType || !base64)
        return Utility.error(ERROR.INVALID_FILE_TYPE);

      const bytes = Utilities.base64Decode(base64);

      let validation = Validation.fileSize(bytes.length);
      if (!validation.success)
        return validation;

      validation = Validation.mimeType(contentType);
      if (!validation.success)
        return validation;

      const link = Database.links.getActive(safeFolderName, "Live");
      if (!link || !link.URL)
        return Utility.error(
          "The " + safeFolderName + " Drive folder is not configured as an active Live link."
        );

      const folder = getFolder(link.URL);
      if (!folder)
        return Utility.error(
          "The configured " + safeFolderName + " Drive folder cannot be accessed."
        );

      const uploaded = folder.createFile(
        Utilities.newBlob(bytes, contentType, safeName)
      );

      return Utility.success(SUCCESS.FILE_UPLOADED, {
        fileId: uploaded.getId(),
        fileName: uploaded.getName(),
        fileUrl: uploaded.getUrl()
      });

    } catch (error) {

      Logger.log("File upload failed: " + (error && error.stack || error));

      const message = Utility.safeString(error && error.message);

      return Utility.error(
        message
          ? "The file could not be uploaded: " + message
          : "The file could not be uploaded. Please try again."
      );

    }

  }
  /**
   * ============================================================
   * GET DRIVE FOLDER
   * ============================================================
   */

  function getFolder(url) {

  if (!url)
    return null;

  try {

    const folderId =

      Utility.safeString(url)

      .match(/[-\w]{25,}/);

    if (!folderId)
      return null;

    return DriveApp.getFolderById(
      folderId[0]
    );

  }

  catch (error) {

    Logger.log(error);

    return null;

  }

}

  /**
   * ============================================================
   * DELETE FILE
   * ============================================================
   */

  function remove(fileId) {

    try {

      DriveApp
        .getFileById(fileId)
        .setTrashed(true);

      return Utility.success(
        SUCCESS.DELETED
      );

    }

    catch (e) {

      return Utility.error(
        ERROR.FILE_NOT_FOUND
      );

    }

  }

  /**
   * ============================================================
   * PART 2 CONTINUES...
   * ============================================================
   */
    /**
   * ============================================================
   * GET FILE
   * ============================================================
   */

  function getFile(fileId) {

    try {

      return DriveApp.getFileById(fileId);

    }

    catch (e) {

      return null;

    }

  }

  /**
   * ============================================================
   * FILE INFORMATION
   * ============================================================
   */

  function fileInfo(fileId) {

    const file = getFile(fileId);

    if (!file)
      return Utility.error(
        ERROR.FILE_NOT_FOUND
      );

    return Utility.success(

      SUCCESS.FETCHED,

      {

        id:
          file.getId(),

        name:
          file.getName(),

        url:
          file.getUrl(),

        mimeType:
          file.getMimeType(),

        size:
          file.getSize(),

        created:
          file.getDateCreated(),

        updated:
          file.getLastUpdated()

      }

    );

  }

  /**
   * ============================================================
   * DOWNLOAD URL
   * ============================================================
   */

  function downloadUrl(fileId) {

    const file = getFile(fileId);

    if (!file)
      return "";

    return file.getDownloadUrl();

  }

  /**
   * ============================================================
   * COPY FILE
   * ============================================================
   */

  function copyFile(fileId, folderUrl) {

    const file =
      getFile(fileId);

    if (!file)
      return Utility.error(
        ERROR.FILE_NOT_FOUND
      );

    const folder =
      getFolder(folderUrl);

    if (!folder)
      return Utility.error(
        ERROR.INVALID_FOLDER
      );

    const copied =
      file.makeCopy(
        file.getName(),
        folder
      );

    return Utility.success(

      SUCCESS.COPIED,

      {

        fileId:
          copied.getId(),

        fileUrl:
          copied.getUrl()

      }

    );

  }

  /**
   * ============================================================
   * MOVE FILE
   * ============================================================
   */

  function moveFile(fileId, folderUrl) {

    const file =
      getFile(fileId);

    if (!file)
      return Utility.error(
        ERROR.FILE_NOT_FOUND
      );

    const folder =
      getFolder(folderUrl);

    if (!folder)
      return Utility.error(
        ERROR.INVALID_FOLDER
      );

    folder.addFile(file);

    const parents =
      file.getParents();

    while (parents.hasNext()) {

      const parent =
        parents.next();

      if (
        parent.getId() !==
        folder.getId()
      ) {

        parent.removeFile(file);

      }

    }

    return Utility.success(
      SUCCESS.MOVED
    );

  }

  /**
   * ============================================================
   * IS IMAGE
   * ============================================================
   */

  function isImage(file) {

    if (!file)
      return false;

    return Utility.safeString(
      file.getMimeType()
    ).startsWith("image/");

  }

  /**
   * ============================================================
   * PUBLIC API
   * ============================================================
   */

  return {

    upload,

    uploadBase64,

    remove,

    getFile,

    fileInfo,

    downloadUrl,

    copyFile,

    moveFile,

    isImage,

    getFolder

  };

})();


