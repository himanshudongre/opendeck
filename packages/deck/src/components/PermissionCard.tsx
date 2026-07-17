import type { PermissionRequest } from '@opendeck/protocol';
import { Keycap } from './Keycap.js';
import { controller } from '../lib/controller.js';

function DiffView({ diff }: { diff: string }) {
  return (
    <pre className="font-data max-h-56 overflow-auto rounded-md p-2 text-[11px] leading-relaxed">
      {diff.split('\n').map((line, index) => {
        const kind =
          line.startsWith('+') && !line.startsWith('+++')
            ? 'diff-line-add'
            : line.startsWith('-') && !line.startsWith('---')
              ? 'diff-line-del'
              : '';
        return (
          <span key={`${String(index)}-${line.slice(0, 8)}`} className={`block px-1 ${kind}`}>
            {line || ' '}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * The real approval a blinking RGB key can't be (SPEC §1): actual command or
 * diff, three honest buttons.
 */
export function PermissionCard({ request }: { request: PermissionRequest }) {
  const canAlways = request.options.includes('always_allow');
  return (
    <section
      aria-label={`Permission request: ${request.tool.name}`}
      className="panel overflow-hidden"
      style={{ borderColor: 'var(--st-waiting)' }}
    >
      <header className="hairline-b flex items-center gap-2 px-3 py-2">
        <span
          aria-hidden
          className="pulse-waiting h-2 w-2 rounded-full"
          style={{ background: 'var(--st-waiting)' }}
        />
        <span className="font-display text-xs text-ink-1">{request.tool.name} wants to run</span>
      </header>
      <div className="px-3 py-2">
        {request.tool.diff !== undefined ? (
          <DiffView diff={request.tool.diff} />
        ) : (
          <pre className="font-data max-h-40 overflow-auto whitespace-pre-wrap p-1 text-[11px] text-ink-1">
            {request.tool.input}
          </pre>
        )}
      </div>
      <footer className="flex gap-2 px-3 pb-3">
        <Keycap
          label={`Deny ${request.tool.name}`}
          className="flex-1 py-2"
          onPress={() => {
            controller.respondPermission(request.id, 'deny');
          }}
        >
          <span className="font-display text-xs" style={{ color: 'var(--st-error)' }}>
            Deny
          </span>
        </Keycap>
        <Keycap
          label={`Approve ${request.tool.name}`}
          className="flex-1 py-2"
          glow="var(--st-done)"
          onPress={() => {
            controller.respondPermission(request.id, 'approve');
          }}
        >
          <span className="font-display text-xs" style={{ color: 'var(--st-done)' }}>
            {request.tool.name === 'Edit' || request.tool.name === 'Write'
              ? 'Approve edit'
              : 'Approve'}
          </span>
        </Keycap>
        {canAlways && (
          <Keycap
            label={`Always allow ${request.tool.name}`}
            className="flex-1 py-2"
            onPress={() => {
              controller.respondPermission(request.id, 'always_allow');
            }}
          >
            <span className="font-display text-xs text-ink-2">Always allow</span>
          </Keycap>
        )}
      </footer>
    </section>
  );
}
