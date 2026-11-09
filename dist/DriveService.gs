/**
 * EMMS - DriveService.gs
 * Penyimpanan foto/dokumen di Google Drive pemilik script. File PRIVAT (tidak dibagikan);
 * dibaca kembali melalui backend sebagai data URL setelah hak akses diperiksa.
 */
const DriveSvc = {
  rootFolder_: function () {
    const props = PropertiesService.getScriptProperties();
    const id = props.getProperty(CFG.DRIVE_ROOT_PROP);
    if (id) {
      try { return DriveApp.getFolderById(id); } catch (e) { /* dibuat ulang di bawah */ }
    }
    const it = DriveApp.getFoldersByName('EMMS_Files');
    const f = it.hasNext() ? it.next() : DriveApp.createFolder('EMMS_Files');
    props.setProperty(CFG.DRIVE_ROOT_PROP, f.getId());
    return f;
  },

  subFolder_: function (name) {
    const root = DriveSvc.rootFolder_();
    const it = root.getFoldersByName(name);
    return it.hasNext() ? it.next() : root.createFolder(name);
  },

  /** Deteksi tipe gambar dari magic bytes (bukan dari klaim klien). */
  sniff_: function (bytes) {
    if (bytes.length > 3 && (bytes[0] & 255) === 0xFF && (bytes[1] & 255) === 0xD8 && (bytes[2] & 255) === 0xFF) return 'image/jpeg';
    if (bytes.length > 8 && (bytes[0] & 255) === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
    return null;
  },

  /** Simpan gambar dari base64. Mengembalikan {fileId, mime, size, name}. */
  saveImage: function (folderName, base64, fileName) {
    const clean = String(base64 || '').replace(/^data:[^,]*,/, '');
    let bytes;
    try { bytes = Utilities.base64Decode(clean); } catch (e) { throw validationError_([{ field: 'photo', rule: 'invalid' }]); }
    if (!bytes.length) throw validationError_([{ field: 'photo', rule: 'required' }]);
    if (bytes.length > CFG.MAX_PHOTO_BYTES) throw validationError_([{ field: 'photo', rule: 'tooLarge' }]);
    const mime = DriveSvc.sniff_(bytes);
    if (!mime) throw validationError_([{ field: 'photo', rule: 'invalid' }]);
    const ext = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');
    const safe = String(fileName || 'photo').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60) + '_' + Date.now() + '.' + ext;
    const file = DriveSvc.subFolder_(folderName).createFile(Utilities.newBlob(bytes, mime, safe));
    return { fileId: file.getId(), mime: mime, size: bytes.length, name: safe };
  },

  readDataUrl: function (fileId) {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  },

  trash: function (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { console.error('trash: ' + e.message); }
  }
};
