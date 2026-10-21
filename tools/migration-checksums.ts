/** Exact historical Operational bytes versus their Git LF checkout. Never normalize arbitrary migrations or rewrite applied ledgers. */
const historicalOperational:Record<string,readonly string[]>={
 '084_operational_runtime.sql':['1923c72629e8ca48e6153b5cabb738e4982994939d6693af8e6d80204622e3f0','f91e40062225bb273a9ac3ba4e8156edc5007d9e02e4de7cd0c1c90a55c927a2'],
 '086_operational_lab_results.sql':['882e185f6101d08fd70e958b7d1c3e7b6b500c65decac5baa7ec7b986f61572c','993e6398e9e57d1f6c2111ad7b0545f9c0edfa95451ddc3b542d44c768a8d1a0'],
 '088_p2_operational_clinical_review.sql':['749e7bf5d5ebee8e4982fb41079a4a588ba1bafc1658af388db47185914a6f9f','16dc8a002402503abc6b01b4f1fed714f440a6836a5fa6c5ff3c1d3ec2cb74fe'],
 '092_native_controlled_documents.sql':['c363125fb1ec4eea8263381301000258415e2d3fa787161c8c947ab10aebf657','2fabde5b36be4a80fabe179e0f2f92a7b0db0decdc00b33141a0a2ba3be2c3c9'],
 '094_owner_three_sheet_master.sql':['96a36d1628feeb8a57f96d1735b12b48528fafd5f3bd07637944a0d5d4cda8cf','cf191d19a928bdbf7a94e57feda81f7380c2b3a864ba60822277fe4913591b14'],
 // Local UAT ledger versus clean Git checkout; exact bytes compared independently.
 '105_dcc_consent_runtime_provenance.sql':['08c73fa1057aa3aadaa1b9420bd97499f0375dfa1e1691c6e480af389bdf8d80','b6707b701768d27b13eb70d2330489b8d5e66603008ef344abbaf71c53bb9f7c'],
};
export function migrationChecksumMatches(name:string,actual:string,recorded:unknown):boolean{
 if(actual===recorded)return true;
 const pair=historicalOperational[name];return !!pair&&pair.includes(actual)&&typeof recorded==='string'&&pair.includes(recorded);
}
