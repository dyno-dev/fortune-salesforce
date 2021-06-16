const jsforce = require('jsforce');
const {
  getRelationships,
  getColumns,
  getMatches,
  getExists,
  getRanges,
  getFuzzyMatches,
  outputErrors,
  outputRecord,
  inputRecord,
  getField,
} = require('./helpers');

/**
 * SalesForce Adapter.
 */
module.exports = (Adapter) =>
  /**
   * Setup the Salescorce connection and download all of the foreign key mappings.
   */
  class SalesforceAdapter extends Adapter {
    constructor(...args) {
      super(...args);
      if (!this.options) {
        this.options = {};
      }

      if (!('typeMap' in this.options)) {
        this.options.typeMap = {};
      }

      if (!('relationshipDelimiter' in this.options)) {
        this.options.relationshipDelimiter = ':';
      }

      if (!('maxLimit' in this.options)) {
        this.options.maxLimit = 200;
      }
    }

    connect() {
      const { Promise, options, recordTypes } = this;
      const { loginUrl, version, username, password, clientId, clientSecret, redirectUri } = options;
      const types = Object.keys(recordTypes);
      let jsForceConn = {};

      if (!loginUrl || !version || !username || !password) {
        throw new Error(
          'A Salesforce loginUrl, username, password and version are required to make a connection with Salesforce.'
        );
      }

      if (clientId || clientSecret) {
        jsForceConn = new jsforce.Connection({
          loginUrl,
          version,
          oauth2: {
            clientId,
            clientSecret,
            redirectUri,
          },
        });
      } else {
        jsForceConn = new jsforce.Connection({
          loginUrl,
          version,
        });
      }

      // Login to Salesforce
      return (
        new Promise((resolve, reject) => {
          jsForceConn.login(username, password, (err) => {
            if (err) {
              reject(err);
            }

            this.conn = jsForceConn;
            resolve(jsForceConn);
          });
        })
          // Get relationship mapping.
          .then(() =>
            Promise.all(
              types.map(
                (type) =>
                  new Promise((resolve) => {
                    resolve(getRelationships(options.typeMap[type] || type, this.conn));
                  })
              )
            )
          ) // Store relationship mapping by recordType.
          .then((results) => {
            /* eslint-disable no-param-reassign */
            const tableColumns = results.reduce((map, result, index) => {
              map[types[index]] = result;
              return map;
            }, {});

            this.foreignKeyMap = tableColumns;
          })
      );
    }

    disconnect() {
      return new Promise((resolve, reject) => {
        this.conn.logout((error) => (error ? reject(error) : resolve()));
      });
    }

    find(type, ids, options, meta) {
      // Handle no-op.
      if (ids && !ids.length) {
        return super.find();
      }

      // Set options if falsy.
      if (!options) options = {};

      const { recordTypes } = this;
      const { typeMap, relationshipDelimiter, maxLimit } = this.options;
      const { primary: primaryKey, isArray: isArrayKey, type: typeKey } = this.keys;
      const query = options.query || ((x) => x);
      const match = options.match || {};
      const exists = options.exists || {};
      const range = options.range || {};
      const fuzzyMatch = options.fuzzyMatch || {};
      const sort = options.sort || {};
      const parameters = [];
      let where = [];
      let order = [];
      let slice = '';

      const defaultFields = recordTypes[type];
      const columns = getColumns({
        primaryKey,
        type,
        defaultFields,
        foreignKeyMap: this.foreignKeyMap,
        options,
        relationshipDelimiter,
        meta,
      });

      const selectColumns = `SELECT ${columns} FROM ${typeMap[type] || type}`;

      if (ids) {
        where.push(`${primaryKey} IN (${ids.map((id) => `'${id}'`).join(', ')})`);
        Array.prototype.push.apply(parameters, ids);
      }

      where = where.concat(getMatches({ type, match, relationshipDelimiter, defaultFields }));
      where = where.concat(getExists({ type, exists, relationshipDelimiter, defaultFields }));
      where = where.concat(getRanges({ type, range, relationshipDelimiter, defaultFields, typeKey }));
      where = where.concat(getFuzzyMatches({ type, fuzzyMatch, relationshipDelimiter, defaultFields }));

      where = where.length ? `WHERE ${where.join(' AND ')}` : '';

      Object.entries(sort).forEach(([field, value]) => {
        const definition = defaultFields[getField(field, relationshipDelimiter)];
        if (!definition || definition[isArrayKey]) return;

        field = field.replace(':', '.');

        order.push(`${field} ${value ? 'ASC' : 'DESC'}`);
      });

      order = order.length ? `ORDER BY ${order.join(', ')}` : '';

      if (options.offset) slice += `OFFSET ${options.offset} `;

      const maxFetch = options.limit && options.limit < maxLimit ? options.limit : maxLimit;
      const findRecords = query(`${selectColumns} ${where} ${order} ${slice}`, parameters);

      const records = [];
      return new Promise((resolve, reject) => {
        const queryResults = this.conn
          .query(findRecords)
          .on('record', (record) => {
            records.push(record);
          })
          .on('end', () => {
            resolve(queryResults);
          })
          .on('error', (err) => {
            const formattedError = [{ errors: [err] }].map(outputErrors.bind(this, type));
            reject(formattedError[0]);
          })
          .run({ maxFetch });
      }).then((results) => {
        const data = records.map(outputRecord.bind(this, type));
        data.count = results.totalSize;

        return data;
      });
    }

    create(type, records) {
      if (!records.length) {
        return super.create();
      }

      const { ConflictError } = this.errors;
      const sObjectType = this.options.typeMap[type] || type;
      const updatedRecords = records.map(inputRecord.bind(this, sObjectType));

      return new Promise((resolve, reject) => {
        if (records.some((rec) => rec.id || rec.Id)) {
          return reject(new ConflictError('Record can not be created with an Id.'));
        }

        return this.conn.sobject(sObjectType).create(updatedRecords, { allOrNone: true }, (err, rets) => {
          if (err) {
            return reject(err);
          }

          const errors = rets.filter((rec) => !rec.success).map(outputErrors.bind(this, sObjectType));

          if (errors.length === updatedRecords.length) {
            // Seems like fortune can handle only one error
            return reject(errors[0]);
          }

          return resolve(
            this.find(
              sObjectType,
              rets.filter((rec) => rec.success).map((r) => r.id)
            )
          );
        });
      });
    }

    update(type, updates) {
      if (!updates.length) {
        return super.update();
      }

      // Ignore updates.push and updates.pull (Salesforce doesn't support array fields)
      const sObjectType = this.options.typeMap[type] || type;
      const records = updates.map((rec) => ({
        Id: rec.id,
        ...rec.replace,
      }));

      return new Promise((resolve, reject) => {
        this.conn.sobject(sObjectType).update(records, { allOrNone: false }, (err, rets) => {
          if (err) {
            return reject(err);
          }

          const errors = rets.filter((rec) => !rec.success).map(outputErrors.bind(this, sObjectType));

          if (errors.length === records.length) {
            // Seems like fortune can handle only one error
            const error = errors[0];

            // If the record didn't exist, it's not an error.
            if (error.title !== 'INVALID_CROSS_REFERENCE_KEY') {
              return reject(error);
            }
          }

          return resolve(rets.filter((rec) => rec.success).length);
        });
      });
    }

    delete(type, ids) {
      if (ids && !ids.length) {
        return super.delete();
      }

      const sObjectType = this.options.typeMap[type] || type;
      const getIdsToDelete = () =>
        ids && ids.length && !ids.every((d) => d === undefined)
          ? Promise.resolve(ids)
          : this.conn.query(`SELECT Id FROM ${sObjectType}`);

      return getIdsToDelete()
        .then((data) => {
          const records = data.records ? data.records.map((rec) => rec.Id) : data;

          if (records.length === 0) {
            return [];
          }

          return this.conn.sobject(sObjectType).del(records);
        })
        .then((res) => {
          const errors = res.filter((rec) => !rec.success).map(outputErrors.bind(this, sObjectType));

          if (errors.length === res.length) {
            // Seems like fortune can handle only one error
            return errors[0];
          }

          return res.filter((rec) => rec.success).length;
        });
    }
  };
