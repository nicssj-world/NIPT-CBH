import {it,expect} from 'vitest';
import {p2Error} from '../../src/server/p2/http';

// Plan Rev 3.4 §11A G5: an idempotency key replayed with different content is a typed 409, not a generic 400.
it('maps a registration idempotency conflict to 409 IDEMPOTENCY_CONFLICT and leaves other errors unchanged',async()=>{
 const conflict=p2Error(new Error('Idempotency conflict'));
 expect(conflict.status).toBe(409);expect((await conflict.json()).code).toBe('IDEMPOTENCY_CONFLICT');
 const other=p2Error(new Error('SOMETHING_ELSE'));
 expect(other.status).toBe(400);expect((await other.json()).code).toBe('INVALID_REQUEST');
});
