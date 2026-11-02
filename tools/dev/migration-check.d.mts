export interface MigrationCheck {id:string;ok:boolean;detail:string}
export interface MigrationRehearsal {ok:boolean;checks:MigrationCheck[];pending:string[];destructive:{migration:string;statements:string[]}[];base:string|null}
export function rehearse(options?:{dir?:string;base?:string|null;gitRoot?:string}):Promise<MigrationRehearsal>;
