import type { AuthChangeEvent, Session, SupabaseClient } from '@supabase/supabase-js';
import type { Owner } from './core/index.js';
import { ActiveLearningContext, type LearningDatabase, type LearningScope } from './storage/learning-db.js';
import { callbackUrl, type ReadyEnvironment } from './environment-config.js';

export interface AuthView { readonly phase:'loading'|'ready'|'error'; readonly owner?:Owner; readonly avatarUrl?:string }
/** The Google profile photo of a signed-in user, when the provider sent one over https. */
function avatarOf(session:Session|null):string|undefined {
  const meta=session?.user?.user_metadata as Record<string,unknown>|undefined;
  const url=meta?.avatar_url ?? meta?.picture;
  return typeof url==='string' && url.startsWith('https://') ? url : undefined;
}
type AuthPort = Pick<SupabaseClient['auth'],'getSession'|'onAuthStateChange'|'signInWithOAuth'|'signOut'>;
/** Identity changes invalidate the active learning scope synchronously, before async work. */
export class V2AuthContext {
  readonly active: ActiveLearningContext;
  private revision=0;
  private disposed=false;
  private signingOut=false;
  private logoutRequested=false;
  private unsubscribe?:()=>void;
  private state:AuthView={phase:'loading'};
  private scope?:LearningScope;
  constructor(private readonly auth:AuthPort, private readonly db:Pick<LearningDatabase,'scope'>,
    private readonly config:ReadyEnvironment, private readonly guestId:string,
    private readonly changed:(view:AuthView)=>void) {
    this.active=new ActiveLearningContext(()=>{});
  }
  get view():AuthView { return this.state; }
  private emit(state:AuthView):void { if(!this.disposed){this.state=state;this.changed(state);} }
  private invalidate():number {
    const revision=++this.revision; this.scope=undefined; this.active.switchTo(undefined);
    this.emit({phase:'loading'}); return revision;
  }
  private identity(session:Session|null):void {
    if(this.disposed || this.signingOut || (this.logoutRequested && session?.user)) return;
    const owner:Owner=session?.user ? {kind:'account',id:session.user.id} : {kind:'guest',id:this.guestId};
    if(this.scope && this.state.owner?.kind===owner.kind && this.state.owner.id===owner.id) return;
    const version=this.invalidate(); const avatarUrl=avatarOf(session);
    // No SDK calls from the auth callback: it runs under the SDK's auth lock.
    void this.db.scope(owner,{dataEpoch:this.config.dataEpoch,epochStartedAt:this.config.epochStartedAt}).then(scope=>{
      if(this.disposed || version!==this.revision) return;
      this.scope=scope; this.active.switchTo(scope); this.emit({phase:'ready',owner,...(avatarUrl?{avatarUrl}:{})});
    }).catch(()=>{if(version===this.revision)this.emit({phase:'error'});});
  }
  async start():Promise<void> {
    const initial=this.revision;
    const {data}=this.auth.onAuthStateChange((_event:AuthChangeEvent,session)=>this.identity(session));
    this.unsubscribe=()=>data.subscription.unsubscribe();
    const result=await this.auth.getSession();
    if(this.disposed || initial!==this.revision) return;
    if(result.error){this.invalidate();this.emit({phase:'error'});return;}
    this.identity(result.data.session);
  }
  async signIn():Promise<void> {
    if(this.disposed) return;
    this.logoutRequested=false;
    const result=await this.auth.signInWithOAuth({provider:'google',options:{redirectTo:callbackUrl(this.config),queryParams:{prompt:'select_account'}}});
    if(result.error) throw new Error('Google sign-in failed');
  }
  async signOut():Promise<void> {
    if(this.disposed) return;
    this.logoutRequested=true;this.signingOut=true; const version=this.invalidate();
    try {
      const result=await this.auth.signOut({scope:'local'});
      if(result.error) throw new Error('Sign-out failed');
      if(!this.disposed && version===this.revision){this.signingOut=false;this.identity(null);}
    } catch(error) {
      if(!this.disposed && version===this.revision)this.emit({phase:'error'});
      throw error;
    } finally {this.signingOut=false;}
  }
  dispose():void {
    this.disposed=true;this.revision++;this.active.switchTo(undefined);this.scope=undefined;this.unsubscribe?.();
  }
}
