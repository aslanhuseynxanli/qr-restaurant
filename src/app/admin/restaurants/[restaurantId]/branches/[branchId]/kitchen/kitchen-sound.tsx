"use client";
import {useEffect,useRef} from "react";
import {newerKitchenNumber} from "@/lib/kitchen";
import {useNotificationSound} from "@/lib/use-notification-sound";
import NotificationSound from "@/components/notification-sound";
export default function KitchenSound({latest,changes,allowed}:{latest:string|null;changes?:string|null;allowed:boolean}){
 const sound=useNotificationSound(allowed),seen=useRef(latest),seenChange=useRef(changes),ring=sound.ring;
 useEffect(()=>{if(newerKitchenNumber(latest,seen.current)){seen.current=latest;if(allowed)ring();}},[latest,allowed,ring]);
 useEffect(()=>{if(changes&&newerKitchenNumber(changes,seenChange.current||null)){seenChange.current=changes;if(allowed)ring();}},[changes,allowed,ring]);
 return <NotificationSound sound={sound} allowed={allowed} label="Mətbəx bildiriş səsi" volumeLabel="Mətbəx səsinin səviyyəsi"/>;
}
