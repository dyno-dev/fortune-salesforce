const run = require('tapdance');
const fortune = require('fortune');
const AdapterSingleton = require('fortune/lib/adapter/singleton');
const common = require('fortune/lib/common');
const helpers = require('../../src/helpers');

const { errors, message } = fortune;
const { SFDate } = helpers;
const { deepEqual, map, find, includes, filter, keys } = common;
const primaryKey = keys.primary;
const type = 'Account';

require('dotenv').config();

const recordTypes = {
  Account: {
    Name: { type: String },
    AccountNumber: { type: String },
    NumberOfEmployees: { type: Number },
    IsOpen__c: { type: Boolean },
    Opened_Date__c: { type: SFDate },
    Parent: { link: 'Account', inverse: 'ChildAccounts' },
    ChildAccounts: { link: 'Account', inverse: 'Parent', isArray: true },
    Owner: { link: 'User' },
    CreatedDate: { type: Date },
    LastModifiedDate: { type: Date },
    CreatedBy: { link: 'User' },
    LastModifiedBy: { link: 'User' },
  },
};

const today = new SFDate();

const defaultRecords = [
  {
    Name: 'ACME',
    AccountNumber: 'A12',
    NumberOfEmployees: 42,
    IsOpen__c: true,
    Opened_Date__c: new SFDate(today.setDate(today.getDate() - 1)),
  },
  {
    Name: 'Sysco',
    AccountNumber: 'B13',
    NumberOfEmployees: 36,
    IsOpen__c: false,
  },
];

function runTest(adapterFn, options, fn) {
  let adapter;

  try {
    adapter = new AdapterSingleton({
      recordTypes,
      message,
      adapter: [adapterFn, options],
    });
  } catch (error) {
    return Promise.reject(error);
  }

  return adapter
    .connect()
    .then(() => {
      // Cleanup Ids
      defaultRecords[0].id = null;
      defaultRecords[1].id = null;

      return adapter.delete(type);
    })
    .then(() => adapter.create(type, [defaultRecords[0]]))
    .then((data) => {
      // Store primary id and set parent
      defaultRecords[0].id = data[0].id;
      defaultRecords[1].Parent = data[0].id;

      return adapter.create(type, [defaultRecords[1]]);
    })
    .then((data) => {
      // Store primary id
      defaultRecords[1].id = data[0].id;

      return fn(adapter);
    })
    .then(() =>
      adapter.delete(
        type,
        map(defaultRecords, (record) => record[primaryKey])
      )
    )
    .then(() => adapter.disconnect())
    .catch((error) => {
      adapter.disconnect();
      throw error;
    });
}

function testIds(assert, records, msg) {
  const types = ['string', 'number'];

  assert(
    find(
      map(records, (record) => includes(types, typeof record[primaryKey])),
      (x) => !x
    ) === undefined,
    msg
  );
}

module.exports = (adpter, opts) => {
  const test = (fn) => runTest(adpter, opts, fn);

  run((assert, comment) => {
    comment('find: nothing');
    return test((adapter) =>
      adapter.find(type, []).then((records) => {
        assert(records.count === 0, 'count is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('find: id, type checking #1');

    return test((adapter) => {
      const { id } = defaultRecords[0];

      adapter.find(type, [id]).then((records) => {
        assert(records.count === 1, 'count is correct');
        assert(records[0][primaryKey] === id, 'id is correct');
        assert(records[0].CreatedDate instanceof Date, 'date type is correct');
        assert(typeof records[0].IsOpen__c === 'boolean', 'boolean type is correct');
        assert(typeof records[0].NumberOfEmployees === 'number', 'number type is correct');
      });
    });
  });

  run((assert, comment) => {
    comment('find: id, type checking #2');

    return test((adapter) => {
      const { id } = defaultRecords[1];

      adapter.find(type, [id]).then((records) => {
        assert(records.count === 1, 'count is correct');
        assert(records[0][primaryKey] === id, 'id is correct');
      });
    });
  });

  run((assert, comment) => {
    comment('find: collection');
    return test((adapter) =>
      adapter.find(type).then((records) => {
        assert(records.count === 2, 'count is correct');
        testIds(assert, records, 'id type is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('find: range (number)');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, { range: { NumberOfEmployees: [36, 38] } }),
        adapter.find(type, null, { range: { NumberOfEmployees: [null, 36] } }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'Sysco', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: range (string)');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, { range: { Name: ['S', null] } }),
        adapter.find(type, null, { range: { Name: ['r', 't'] } }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'Sysco', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: range (date)');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, {
          range: {
            Opened_Date__c: [null, new SFDate()],
          },
        }),
        adapter.find(type, null, {
          range: {
            Opened_Date__c: [new SFDate(new Date().getDate() - 2), new SFDate()],
          },
        }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'ACME', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: fuzzyMatch');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, {
          fuzzyMatch: {
            'Parent:Name': 'AC',
          },
        }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'Sysco', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: match (related string)');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, {
          match: {
            'Parent:Name': 'ACME',
          },
        }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'Sysco', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: match (link number)');
    return test((adapter) =>
      Promise.all([
        adapter.find(type, null, {
          match: {
            'Parent:NumberOfEmployees': 42,
          },
        }),
      ]).then((results) => {
        results.forEach((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0].Name === 'Sysco', 'matched correct record');
        });
      })
    );
  });

  run((assert, comment) => {
    comment('find: match (string)');
    return test((adapter) =>
      adapter.find(type, null, { match: { Name: ['Sysco', 'xyz'], NumberOfEmployees: 36 } }).then((records) => {
        assert(records.length === 1, 'match length is correct');
        assert(records[0].Name === 'Sysco', 'matched correct record');
      })
    );
  });

  run((assert, comment) => {
    comment('find: match (link)');
    return test((adapter) => {
      const parent = defaultRecords[0].id;
      adapter.find(type, null, { match: { 'Parent:Id': parent } }).then((records) => {
        assert(records.length === 1, 'match length is correct');
        assert(records[0].Name === 'Sysco', 'matched correct record');
      });
    });
  });

  run((assert, comment) => {
    comment('find: match (nothing)');
    return test((adapter) =>
      adapter.find(type, null, { match: { Name: 'ACME', NumberOfEmployees: 36 } }).then((records) => {
        assert(records.length === 0, 'match length is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('find: sort ascending');
    return test((adapter) =>
      adapter.find(type, null, { sort: { NumberOfEmployees: true } }).then((records) => {
        assert(
          deepEqual(
            map(records, (record) => record.NumberOfEmployees),
            [36, 42]
          ),
          'ascending sort order correct'
        );
      })
    );
  });

  run((assert, comment) => {
    comment('find: sort descending');
    return test((adapter) =>
      adapter.find(type, null, { sort: { NumberOfEmployees: false } }).then((records) => {
        assert(
          deepEqual(
            map(records, (record) => record.NumberOfEmployees),
            [42, 36]
          ),
          'descending sort order correct'
        );
      })
    );
  });

  run((assert, comment) => {
    comment('find: sort combination');
    return test((adapter) =>
      adapter.find(type, null, { sort: { NumberOfEmployees: true, Name: true } }).then((records) => {
        assert(
          deepEqual(
            map(records, (record) => record.NumberOfEmployees),
            [36, 42]
          ),
          'sort order is correct'
        );
      })
    );
  });

  run((assert, comment) => {
    comment('find: offset + limit');
    return test((adapter) =>
      adapter.find(type, null, { offset: 1, limit: 1, sort: { Name: true } }).then((records) => {
        assert(records[0].Name === 'Sysco', 'record is correct');
        assert(records.length === 1, 'offset length is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('find: fields #1');
    return test((adapter) =>
      adapter.find(type, null, { fields: { Name: true, IsOpen__c: true } }).then((records) => {
        assert(!find(records, (record) => Object.keys(record).length !== 3), 'fields length is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('find: fields #2');
    return test((adapter) =>
      adapter.find(type, null, { fields: { Name: false, IsOpen__c: false } }).then((records) => {
        assert(!find(records, (record) => Object.keys(record).length !== 8), 'fields length is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('create: no-op');
    return test((adapter) =>
      adapter.create(type, []).then((records) => {
        assert(deepEqual(records, []), 'response is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('create: type check');
    return test((adapter) => {
      const date = new SFDate();

      return adapter
        .create(type, [
          {
            Name: 'Type Check',
            IsOpen: true,
            Opened_Date__c: date,
          },
        ])
        .then((records) => {
          assert(typeof records[0].IsOpen__c === 'boolean', 'boolean type is correct');
          assert(
            Math.abs(new Date(records[0].Opened_Date__c).getTime() - date.getTime()) > 1000,
            'date value is correct'
          );
        });
    });
  });

  run((assert, comment) => {
    comment('create: duplicate id creation should fail');
    return test((adapter) => {
      const { id } = defaultRecords[0];

      return adapter
        .create(type, [{ id }])
        .then(() => {
          assert(false, 'duplicate id creation should have failed');
        })
        .catch((error) => {
          assert(error instanceof errors.ConflictError, 'error type is correct');
        });
    });
  });

  run((assert, comment) => {
    comment('create: id generation and lookup');
    return test((adapter) => {
      let id;

      return adapter
        .create(type, [
          {
            Name: 'joe',
          },
        ])
        .then((records) => {
          id = records[0][primaryKey];
          testIds(assert, records, 'id type is correct');

          assert(deepEqual(records[0].ChildAccounts, []), 'array should be empty');

          return adapter.find(type, [id]);
        })
        .then((records) => {
          assert(records.length === 1, 'match length is correct');
          assert(records[0][primaryKey] === id, 'id is matching');
          testIds(assert, records, 'id type is correct');
        });
    });
  });

  run((assert, comment) => {
    comment('create: records returned in same order');
    return test((adapter) =>
      adapter.create(type, [{ Name: 'a' }, { Name: 'b' }, { Name: 'c' }]).then((records) => {
        assert(
          deepEqual(
            records.map((record) => record.Name),
            ['a', 'b', 'c']
          ),
          'records returned in the same order'
        );
      })
    );
  });

  run((assert, comment) => {
    comment('update: no-op');
    return test((adapter) =>
      adapter.update(type, []).then((number) => {
        assert(number === 0, 'number is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('update: not found');
    return test((adapter) =>
      adapter
        .update(type, [
          {
            id: '001000000000000',
            replace: { Name: 'bar' },
          },
        ])
        .then((number) => {
          assert(number === 0, 'number is correct');
        })
    );
  });

  run((assert, comment) => {
    comment('update: replace');
    return test((adapter) =>
      adapter
        .update(type, [
          { id: defaultRecords[0].id, replace: { AccountNumber: 'billy' } },
          { id: defaultRecords[1].id, replace: { AccountNumber: 'billy', IsOpen__c: false } },
        ])
        .then((number) => {
          assert(number === 2, 'number updated correct');
          return adapter.find(type);
        })
        .then((records) => {
          assert(
            deepEqual(find(records, (record) => record[primaryKey] === defaultRecords[1].id).IsOpen__c, false),
            'boolean updated'
          );
          assert(filter(records, (record) => record.AccountNumber !== 'billy').length === 0, 'field updated on set');
        })
    );
  });

  run((assert, comment) => {
    comment('update: unset');
    return test((adapter) => {
      adapter
        .update(type, [
          { id: defaultRecords[0].id, replace: { AccountNumber: null } },
          { id: defaultRecords[1].id, replace: { AccountNumber: null } },
        ])
        .then((number) => {
          assert(number === 2, 'number updated correct');
          return adapter.find(type);
        })
        .then((records) => {
          assert(filter(records, (record) => record.AccountNumber !== null).length === 0, 'field updated on unset');
        });
    });
  });

  run((assert, comment) => {
    comment('delete: no-op');
    return test((adapter) =>
      adapter.delete(type, []).then((number) => {
        assert(number === 0, 'number is correct');
      })
    );
  });

  run((assert, comment) => {
    comment('delete');
    return test((adapter) =>
      adapter
        .delete(type, [defaultRecords[0].id, '001000000000000'])
        .then((number) => {
          assert(number === 1, 'number deleted correct');
          return adapter.find(type, [defaultRecords[0].id, defaultRecords[1].id]);
        })
        .then((records) => {
          assert(records.count === 1, 'count correct');
          assert(
            deepEqual(
              map(records, (record) => record[primaryKey]),
              [defaultRecords[1].id]
            ),
            'record deleted'
          );
        })
    );
  });
};
