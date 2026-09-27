/**
 * The form fields every form in Aldilivery uses, so every one behaves the same.
 *
 * Every field has a real `label` joined to a real `input`, and a hint underneath joined with
 * `aria-describedby`, because a hint that only appears on hover or in a placeholder is a hint
 * a screen reader user never gets. A radio button's row is the full forty eight pixels high,
 * so it is easy to hit.
 */

export function Field({
  id,
  label,
  hint,
  type = 'text',
  autoComplete,
  multiline = false,
}: {
  id: string;
  label: string;
  hint: string;
  type?: string;
  autoComplete?: string;
  multiline?: boolean;
}): JSX.Element {
  const hintId = `${id}-hint`;
  const shared = {
    id,
    name: id,
    'aria-describedby': hintId,
    className: 'w-full min-h-control rounded-xl border-2 border-paper bg-paper text-ink p-3',
  };

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-lead font-bold">
        {label}
      </label>
      <p id={hintId} className="m-0 text-paper/90">
        {hint}
      </p>
      {multiline ? (
        <textarea {...shared} rows={3} autoComplete={autoComplete} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
    </div>
  );
}

export function Radio({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}): JSX.Element {
  const id = `${name}-${value}`;
  return (
    <div className="flex items-center gap-3 min-h-control">
      <input
        type="radio"
        id={id}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="h-6 w-6"
      />
      <label htmlFor={id} className="m-0">
        {label}
      </label>
    </div>
  );
}
