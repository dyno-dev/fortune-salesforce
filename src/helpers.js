function SFDate(d) {
  return d ? new Date(d) : new Date();
}
SFDate.prototype = new Date();

function formatDate(date) {
  let month = `${date.getMonth() + 1}`;
  let day = `${date.getDate()}`;
  const year = date.getFullYear();

  if (month.length < 2) month = `0${month}`;
  if (day.length < 2) day = `0${day}`;

  return [year, month, day].join('-');
}

async function getRelationships(name, conn) {
  const relationships = new Map();
  const meta = await conn.sobject(name).describe();

  meta.childRelationships.map((field) => relationships.set(field.relationshipName, field.field));
  meta.fields
    .filter((field) => field.type === 'reference')
    .map((field) => relationships.set(field.relationshipName, field.name));

  return relationships;
}

function inputRecord(type, record) {
  const { recordTypes, keys, foreignKeyMap } = this;
  const { isArray: isArrayKey, type: typeKey } = keys;
  const fields = recordTypes[type];

  /* eslint-disable no-param-reassign */
  return Object.entries(fields).reduce((rec, [field, definition]) => {
    if (!Object.prototype.hasOwnProperty.call(record, field) || definition[isArrayKey]) {
      return rec;
    }

    const value = record[field];

    if (definition.link) {
      const mappingField = foreignKeyMap[type].get(field);
      rec[mappingField] = value;
    } else if (definition[typeKey] === Date) {
      rec[field] = new Date(value).toISOString();
    } else if (definition[typeKey] === SFDate) {
      rec[field] = formatDate(value);
    } else {
      rec[field] = value;
    }

    return rec;
  }, {});
}

function outputRecord(type, record) {
  const { recordTypes, keys } = this;
  const primaryKey = keys.primary;
  const typeKey = keys.type;
  const fields = recordTypes[type];

  /* eslint-disable no-param-reassign */
  return Object.entries(fields).reduce(
    (rec, [field, definition]) => {
      const fieldType = definition[typeKey];

      if (record[field] && fieldType === Date) {
        rec[field] = new Date(record[field]);
        return rec;
      }

      if (record[field] !== null && fieldType === Boolean) {
        rec[field] = Boolean(record[field]);
        return rec;
      }

      if (record[field] && fieldType === Number) {
        rec[field] = Number(record[field]);
        return rec;
      }

      // If Child relationship and has data
      if (definition.isArray) {
        const value = record[field] && record[field].totalSize ? record[field].records.map((d) => d.Id) : [];

        Object.defineProperty(rec, field, {
          value,
          writable: true,
          configurable: true,
        });
        return rec;
      }

      // If Relationship
      if (definition.link) {
        const linkKey = this.foreignKeyMap[type].get(field);

        if (linkKey && record[linkKey]) {
          Object.defineProperty(rec, field, {
            value: record[linkKey],
            writable: true,
            configurable: true,
          });
        }

        return rec;
      }

      if (record[field] !== undefined) {
        rec[field] = record[field];
      }

      return rec;
    },
    {
      [primaryKey]: record.id ? record.id : record.Id,
    }
  );
}

function outputErrors(type, record) {
  const { UnprocessableError } = this.errors;

  const sfError = record.errors[0];
  const err = new UnprocessableError(sfError.message);
  err.title = sfError.statusCode || sfError.errorCode;
  err.status = 422;

  if (sfError.fields && sfError.fields.length > 0) {
    err.source = {
      pointer: `/data/attributes/${sfError.fields[0]}`,
    };
  }

  return err;
}

function getField(field, delimiter) {
  const [fld] = field.split(delimiter);

  return fld;
}

function getMatches({ type, match, relationshipDelimiter, defaultFields }) {
  const where = [];

  Object.entries(match).forEach(([field, value]) => {
    const definition = defaultFields[getField(field, relationshipDelimiter)];
    if (!definition || (definition.isArray && definition.link !== type)) return;

    if (definition.isArray) {
      [, field] = field.split(relationshipDelimiter);
    } else {
      field = field.replace(':', '.');
    }

    // Check if array and if the first value is a string, assume it's a array of strings
    if (Array.isArray(value) && typeof value[0] === 'string') {
      where.push(`${field} IN ('${value.join("', '")}')`);
    } else if (Array.isArray(value)) {
      where.push(`${field} IN ('${value.join(', ')}')`);
    } else if (typeof value[0] === 'string') {
      where.push(`${field} = '${value}'`);
    } else {
      where.push(`${field} = ${value}`);
    }
  });

  return where;
}

function getExists({ type, exists, relationshipDelimiter, defaultFields }) {
  const where = [];

  Object.entries(exists).forEach(([field, value]) => {
    const definition = defaultFields[getField(field, relationshipDelimiter)];
    if (!definition || (definition.isArray && definition.link !== type)) return;

    if (definition.isArray) {
      [, field] = field.split(relationshipDelimiter);
    } else {
      field = field.replace(':', '.');
    }

    where.push(`${field} ${value ? 'IS NOT NULL' : 'IS NULL'}`);
  });

  return where;
}

function getRanges({ type, range, relationshipDelimiter, defaultFields, typeKey }) {
  const where = [];

  Object.entries(range).forEach(([field, value]) => {
    const definition = defaultFields[getField(field, relationshipDelimiter)];
    if (!definition || (definition.isArray && definition.link !== type)) return;

    if (definition.isArray) {
      [, field] = field.split(relationshipDelimiter);
    } else {
      field = field.replace(':', '.');
    }

    if (value[0] != null) {
      const firstRange = value[0];

      if (defaultFields[field][typeKey] === Date) {
        where.push(`${field} >= ${firstRange.toISOString()}`);
      } else if (defaultFields[field][typeKey] === SFDate) {
        where.push(`${field} >= ${formatDate(firstRange)}`);
      } else if (typeof firstRange === 'string') {
        where.push(`${field} >= '${firstRange}'`);
      } else {
        where.push(`${field} >= ${firstRange}`);
      }
    }

    if (value[1] != null) {
      const secRange = value[1];

      if (defaultFields[field][typeKey] === Date) {
        where.push(`${field} <= ${secRange.toISOString()}`);
      } else if (defaultFields[field][typeKey] === SFDate) {
        where.push(`${field} <= ${formatDate(secRange)}`);
      } else if (typeof secRange === 'string') {
        where.push(`${field} <= '${secRange}'`);
      } else {
        where.push(`${field} <= ${secRange}`);
      }
    }
  });

  return where;
}

function getFuzzyMatches({ type, fuzzyMatch, relationshipDelimiter, defaultFields }) {
  const where = [];

  Object.entries(fuzzyMatch).forEach(([field, value]) => {
    const definition = defaultFields[getField(field, relationshipDelimiter)];
    if (!definition || (definition.isArray && definition.link !== type)) return;

    if (definition.isArray) {
      [, field] = field.split(relationshipDelimiter);
    } else {
      field = field.replace(':', '.');
    }

    where.push(`${field} LIKE '${value}%'`);
  });

  return where;
}

function getColumns({ primaryKey, type, defaultFields, foreignKeyMap, options, relationshipDelimiter, meta }) {
  let columns = [primaryKey];
  const defaultFieldNames = Object.keys(defaultFields);
  const includedRelationships = meta?.request?.query?.include;
  const includedFields = meta?.request?.query.fields ? meta.request.query.fields[type] : null;
  const optionFields = options.fields ? Object.keys(options.fields).filter((field) => options.fields[field]) : null;

  // Check for fields provided by the user
  if (optionFields) {
    columns = columns.concat(optionFields);
  } else if (includedFields) {
    columns = columns.concat(includedFields.split(','));
  }

  // No fields were provided by a user, then use default fields that are not relationship fields
  if (columns.length === 1) {
    columns = columns.concat(Object.keys(defaultFields).filter((field) => !defaultFields[field].link));
  }

  // Include user fields for related relationships
  if (includedRelationships) {
    columns = columns.concat(
      defaultFieldNames.filter((field) =>
        includedRelationships.some((column) => column === field && !columns.includes(field))
      )
    );
  }

  // Convert Relationship fields
  return columns
    .map((field) => {
      const info = defaultFields[field] || {};

      if (info && info.isArray) {
        const match = options.match || {};
        const exists = options.exists || {};
        const range = options.range || {};
        const fuzzyMatch = options.fuzzyMatch || {};

        let where = [];

        if (includedRelationships && includedRelationships.includes(field)) {
          where = where.concat(getMatches({ type: info.link, match, relationshipDelimiter, defaultFields }));
          where = where.concat(getExists({ type: info.link, exists, relationshipDelimiter, defaultFields }));
          where = where.concat(getRanges({ type: info.link, range, relationshipDelimiter, defaultFields }));
          where = where.concat(getFuzzyMatches({ type: info.link, fuzzyMatch, relationshipDelimiter, defaultFields }));
        }

        return `(SELECT Id FROM ${field} ${where.length ? `WHERE ${where.join(' AND ')}` : ''})`;
      }

      if (info && info.link) {
        const value = foreignKeyMap[type].get(field);
        if (value) {
          return value;
        }
      }

      return field;
    })
    .map((column) => `${column}`)
    .join(', ');
}

module.exports = {
  getRelationships,
  inputRecord,
  outputRecord,
  getColumns,
  getField,
  getMatches,
  getExists,
  getRanges,
  getFuzzyMatches,
  outputErrors,
  SFDate,
};
