# Fortune Salesforce Adapter

This is a Salesforce adapter for Fortune which makes use of specific Salesforce functionality. Key features include:

- **SOQL building**: it interprets arguments from Fortune's adapter interface directly, and generates optimized queries.

To use this adapter, the salesforce user information must be setup prior to attempting to connect.

_This adapter, along with Fortune.js, does not implement ORM. This adapter uses jsforce package, and translates the adapter interface directly into SOQL statements that is then passed to jsforce. It is a plain query builder for Salesforce._

## Requirements

- A Salesforce instance and active Salesforce User.

## Usage

Install the `fortune-salesforce` package from `npm`:

```
$ npm install fortune-salesforce
```

Then use it with Fortune:

```js
const fortune = require('fortune')
const salesforceAdapter = require('fortune-salesforce')

const store = fortune({ ... }, {
  adapter: [
    salesforceAdapter,
    {
      // options object
      {
        loginUrl: process.env.SF_LOGIN_URL,
        username: process.env.SF_USERNAME,
        password: process.env.SF_PASSWORD,
        version: process.env.SF_API_VERSION,
        clientId: process.env.SF_CLIENT_ID, // Optional
        clientSecret: process.env.SF_CLIENT_SECRET, // Optional
        redirectUri: process.env.SF_REDIRECT_URI, // Optional
        typeMap: { // Optional
          Accounts: 'Account',
          Cases: 'Case',
          Contacts: 'Contact',
          Opportunities: 'Opportunity',
          OpportunityLineItems: 'OpportunityLineItem',
          Products: 'Product2',
          RecordTypes: 'RecordType',
          Users: 'User'
        },
        relationshipDelimiter: '.' // Optional - Only works with https://github.com/dyno-dev/fortune-json-api
      }
    }
  ]
})
```

## Options

- `loginUrl`: Login URL string. **Required**
- `username`:Salesforce username. **Required**
- `password`: Salesforce password (and security token, if available) **Required**
- `version`: Salesforce API Version. **Required**
- `clientId`: Salesforce Client Id.
- `clientSecret`: Salesforce Client Secret.
- `redirectUri`: Salesforce Redirect URI.
- `typeMap`: an object keyed by type name and valued by table name.

## Testing

SFDX CLI is required. To setup, run npm run test:setup. This will create the scratch org and print the user details to login. If there is an existing account and entitlement in the new scratch org, you will have to delete the entitlement and then you can run the test scripts.

## License

This software is licensed under the [MIT License](//github.com/fortunejs/fortune-postgres/blob/master/LICENSE).
