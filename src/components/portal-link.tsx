"use client";
import Link,{useLinkStatus,type LinkProps} from "next/link";
import type {ReactNode} from "react";
function Pending(){const {pending}=useLinkStatus();return <span aria-hidden="true" className={`ml-auto inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent ${pending?"animate-spin opacity-100":"opacity-0"}`}/>;}
export default function PortalLink({children,className="",...props}:LinkProps&{children:ReactNode;className?:string;"aria-current"?:"page"}){return <Link {...props} className={`flex min-h-11 items-center gap-2 ${className}`}>{children}<Pending/></Link>;}
