/** Exact historical Operational bytes versus their Git LF checkout. Never normalize arbitrary migrations or rewrite applied ledgers. */
const historicalOperational:Record<string,readonly string[]>={
 '084_operational_runtime.sql':['1923c72629e8ca48e6153b5cabb738e4982994939d6693af8e6d80204622e3f0','f91e40062225bb273a9ac3ba4e8156edc5007d9e02e4de7cd0c1c90a55c927a2'],
 '086_operational_lab_results.sql':['882e185f6101d08fd70e958b7d1c3e7b6b500c65decac5baa7ec7b986f61572c','993e6398e9e57d1f6c2111ad7b0545f9c0edfa95451ddc3b542d44c768a8d1a0'],
 '088_p2_operational_clinical_review.sql':['749e7bf5d5ebee8e4982fb41079a4a588ba1bafc1658af388db47185914a6f9f','16dc8a002402503abc6b01b4f1fed714f440a6836a5fa6c5ff3c1d3ec2cb74fe'],
 '092_native_controlled_documents.sql':['c363125fb1ec4eea8263381301000258415e2d3fa787161c8c947ab10aebf657','2fabde5b36be4a80fabe179e0f2f92a7b0db0decdc00b33141a0a2ba3be2c3c9'],
 '094_owner_three_sheet_master.sql':['96a36d1628feeb8a57f96d1735b12b48528fafd5f3bd07637944a0d5d4cda8cf','cf191d19a928bdbf7a94e57feda81f7380c2b3a864ba60822277fe4913591b14'],
 // Local UAT ledger versus clean Git checkout; exact bytes compared independently.
 '105_dcc_consent_runtime_provenance.sql':['08c73fa1057aa3aadaa1b9420bd97499f0375dfa1e1691c6e480af389bdf8d80','b6707b701768d27b13eb70d2330489b8d5e66603008ef344abbaf71c53bb9f7c'],
 // Isolated Task 3 UAT only: the additive admin_access_supersession GRANT was applied directly
 // with the SHA below and then committed to the local UAT migration ledger.
 // Only this exact recorded hash and this exact checked-in migration body are compatible.
 '130_admin_access_supersession_grant.sql':['347e4dc6171072a43f0f0ca79402c2f1ec7c2d9f71dee02ff9949e66ae5aa920','aaa7b13d4e5d0b4a4a507470ab40245180fc123189a5e6b08a7d6982237eec3c'],
 // Isolated local UAT ledgers applied these three from CRLF working copies; the committed source is LF (.gitattributes eol=lf).
 // Exact bytes compared independently (CRLF hash recorded in the ledger, LF hash of the committed file); nothing else is accepted.
 '131_anc_pet_current_identity.sql':['f6efe10ae2efe18f894a9a5b73eb75226036578db5b1835394c9bbc141c3bc90','f4f6f69235354289d20354f1a1ee6d06df5810a1f2c4c53bd76030719644981e'],
 '132_anc_own_profile.sql':['6a71c7fb2f34fa1614ce6f4b8a0a7aeff3c37751c733afae9a0bde422dc06ad5','e746aa2695413ec322b75a283aedaaa90cb049060aa1a2f45e499354bf66a7f9'],
 '133_restore_pet_clinical_lineage.sql':['91b7ca62c53cacbc99ac28c75be85d74305b10876b6fc926920ebc3348e82c1e','973d39043ee6a608cecb3e1af7d48ecf360543b393d5d70afff3ef20e73d01c8'],
};
export function migrationChecksumMatches(name:string,actual:string,recorded:unknown):boolean{
 if(actual===recorded)return true;
 const pair=historicalOperational[name];return !!pair&&pair.includes(actual)&&typeof recorded==='string'&&pair.includes(recorded);
}
