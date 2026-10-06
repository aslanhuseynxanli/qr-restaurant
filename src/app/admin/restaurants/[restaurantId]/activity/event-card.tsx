import {activityCategories,formatOwnerTime,ownerEventDetails,ownerEventTitle,type OwnerEvent} from "@/lib/owner-dashboard";
export default function EventCard({event}:{event:OwnerEvent}) {
  const details=ownerEventDetails(event);
  return <article aria-label={ownerEventTitle(event)} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">{activityCategories[event.category]||"Digər"}</span><time dateTime={event.created_at} className="text-xs text-slate-500">{formatOwnerTime(event.created_at)}</time></div>
    <h3 className="break-words font-semibold text-slate-900">{ownerEventTitle(event)}</h3>
    {!!details.length&&<p className="break-words text-sm leading-6 text-slate-600">{details.join(" · ")}</p>}
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-slate-500"><span className="break-words">{event.actor_name}{event.actor_role&&event.actor_name!==event.actor_role?` · ${event.actor_role}`:""}</span>{event.branch_name&&<span className="break-words">{event.branch_name}</span>}</div>
  </article>;
}
