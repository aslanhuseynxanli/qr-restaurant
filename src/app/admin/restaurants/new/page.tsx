import {redirect} from "next/navigation";
import WorkspaceShell from "@/components/workspace-shell";
import {getWorkspace} from "@/lib/workspace";
import RestaurantForm from "./restaurant-form";
export default async function NewRestaurantPage(){const {workspace,userId}=await getWorkspace();if(!workspace.active||!workspace.super_admin)redirect("/admin");return <WorkspaceShell workspace={workspace} userId={userId}><RestaurantForm/></WorkspaceShell>;}
