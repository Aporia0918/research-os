// The care message in place of whatever the typed text would have done. Fixed text, one line a sentence.
import { CARE } from '../rules/care';
import { tr } from '../i18n';

export const CareNote = () => (
  <div className="card care" role="alert" data-testid="care">{CARE.split('\n').map(l => <p key={l}>{tr(l)}</p>)}</div>
);
