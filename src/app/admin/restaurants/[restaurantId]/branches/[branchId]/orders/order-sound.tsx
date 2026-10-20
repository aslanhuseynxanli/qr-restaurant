"use client";
import {useEffect,useRef} from "react";
import type {StaffBoard} from "@/lib/qr-orders";
import {useNotificationSound} from "@/lib/use-notification-sound";
import NotificationSound from "@/components/notification-sound";
function notifications(board:StaffBoard){return board.sessions.flatMap(s=>[...s.orders.map(o=>({id:`order:${o.id}`,status:o.status})),...s.services.map(c=>({id:`call:${c.id}`,status:c.status}))]);}
export default function OrderSound({board}:{board:StaffBoard}){
 const allowed=board.sound_enabled!==false,sound=useNotificationSound(allowed),known=useRef(new Set(notifications(board).map(i=>i.id))),ready=useRef(new Set(notifications(board).filter(i=>i.status==="READY").map(i=>i.id)));
 const ring=sound.ring;
 useEffect(()=>{const items=notifications(board);const incoming=items.some(i=>i.status==="NEW"&&!known.current.has(i.id)&&(board.can_prepare!==false||i.id.startsWith("call:")));const prepared=board.can_prepare===false&&items.some(i=>i.status==="READY"&&!ready.current.has(i.id));for(const i of items){known.current.add(i.id);if(i.status==="READY")ready.current.add(i.id);}if(known.current.size>10000)known.current=new Set(items.map(i=>i.id));if(ready.current.size>10000)ready.current=new Set(items.filter(i=>i.status==="READY").map(i=>i.id));if(allowed&&(incoming||prepared))ring();},[board,allowed,ring]);
 return <NotificationSound sound={sound} allowed={allowed} label="Ofisiant bildiriş səsi" volumeLabel="Bildiriş səsinin səviyyəsi"/>;
}
