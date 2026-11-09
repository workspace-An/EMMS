/**
 * EMMS - Master.gs
 * Master data: pabrik, gedung, lokasi, kategori equipment. Hapus = soft delete dan diblokir bila masih dipakai.
 */
const Master = {
  ENT: {
    factory: {
      sheet: 'FACTORIES', fields: ['FactoryName', 'Address', 'Description'], req: ['FactoryName'], max: 200,
      refs: [['BUILDINGS', 'FactoryID']], uniqueBy: ['FactoryName']
    },
    building: {
      sheet: 'BUILDINGS', fields: ['FactoryID', 'BuildingName', 'Description'], req: ['FactoryID', 'BuildingName'], max: 200,
      refs: [['LOCATIONS', 'BuildingID'], ['EQUIPMENT', 'BuildingID']], uniqueBy: ['FactoryID', 'BuildingName'],
      parents: { FactoryID: 'FACTORIES' }
    },
    location: {
      sheet: 'LOCATIONS', fields: ['BuildingID', 'LocationName', 'ProductionArea', 'Description'], req: ['BuildingID', 'LocationName'], max: 200,
      refs: [['EQUIPMENT', 'LocationID']], uniqueBy: ['BuildingID', 'LocationName'],
      parents: { BuildingID: 'BUILDINGS' }
    },
    category: {
      sheet: 'EQUIPMENT_CATEGORIES', fields: ['CategoryName', 'Code', 'Description', 'InspectionType'], req: ['CategoryName', 'Code'], max: 200,
      refs: [['EQUIPMENT', 'CategoryID'], ['INSPECTION_CHECKLISTS', 'CategoryID']], uniqueBy: ['Code']
    }
  },

  /** Semua master data aktif (tanpa kolom CreatedBy/UpdatedBy agar email tidak terbuka ke semua role). */
  all: function () {
    const strip = function (arr) {
      return arr.map(function (r) { const o = Object.assign({}, r); delete o.CreatedBy; delete o.UpdatedBy; return o; });
    };
    return {
      factories: strip(Db.all('FACTORIES')),
      buildings: strip(Db.all('BUILDINGS')),
      locations: strip(Db.all('LOCATIONS')),
      categories: strip(Db.all('EQUIPMENT_CATEGORIES'))
    };
  },

  save: function (p, actor) {
    const ent = Master.ENT[p && p.entity];
    if (!ent) throw new AppError('NOT_FOUND', 'Unknown entity');
    const d = p.data || {};
    const errors = [];
    const clean = {};
    ent.fields.forEach(function (f) {
      const v = String(d[f] === undefined || d[f] === null ? '' : d[f]).trim();
      if (v.length > ent.max) errors.push({ field: f, rule: 'tooLong' });
      if (ent.req.indexOf(f) !== -1 && !v) errors.push({ field: f, rule: 'required' });
      clean[f] = v;
    });
    if (ent.sheet === 'EQUIPMENT_CATEGORIES' && clean.Code && !/^[A-Za-z0-9_-]{1,12}$/.test(clean.Code)) errors.push({ field: 'Code', rule: 'invalid' });
    if (errors.length) throw validationError_(errors);

    return Db.withLock(function () {
      Object.keys(ent.parents || {}).forEach(function (f) {
        if (!Db.get(ent.parents[f], clean[f])) throw validationError_([{ field: f, rule: 'notFound' }]);
      });
      const pk = SCHEMA[ent.sheet].pk;
      const dup = Db.where(ent.sheet, function (r) {
        return r[pk] !== d[pk] && ent.uniqueBy.every(function (f) { return String(r[f]).toLowerCase() === clean[f].toLowerCase(); });
      });
      if (dup.length) throw new AppError('CONFLICT', 'Duplicate', { rule: 'duplicate', field: ent.uniqueBy[ent.uniqueBy.length - 1] });

      if (!d[pk]) {
        const rec = Db.insert(ent.sheet, clean, actor.email);
        Audit.log(actor, 'MASTER_CREATE', ent.sheet, rec[pk], clean, 'OK');
        return rec;
      }
      const res = Db.update(ent.sheet, d[pk], clean, actor.email, { expectedUpdatedAt: d.UpdatedAt });
      Audit.log(actor, 'MASTER_UPDATE', ent.sheet, d[pk], diffObjects_(res.before, res.after, ent.fields), 'OK');
      return res.after;
    });
  },

  remove: function (p, actor) {
    const ent = Master.ENT[p && p.entity];
    if (!ent) throw new AppError('NOT_FOUND', 'Unknown entity');
    const id = String(p.id || '');
    return Db.withLock(function () {
      const rec = Db.get(ent.sheet, id);
      if (!rec) throw new AppError('NOT_FOUND', 'Not found');
      const used = ent.refs.some(function (r) {
        return Db.count(r[0], function (x) { return x[r[1]] === id; }) > 0;
      });
      if (used) throw new AppError('CONFLICT', 'In use', { rule: 'inUse' });
      Db.update(ent.sheet, id, { Status: 'Deleted' }, actor.email);
      Audit.log(actor, 'MASTER_DELETE', ent.sheet, id, null, 'OK');
      return { id: id };
    });
  }
};
