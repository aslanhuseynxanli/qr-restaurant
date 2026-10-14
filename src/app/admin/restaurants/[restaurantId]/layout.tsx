import WorkspaceShell from "@/components/workspace-shell";
import {restaurantWorkspace} from "@/lib/workspace";
export default async function RestaurantLayout({children,params}:{children:React.ReactNode;params:Promise<{restaurantId:string}>}){
  const {restaurantId}=await params,{workspace,userId}=await restaurantWorkspace(restaurantId);
  return <WorkspaceShell workspace={workspace} userId={userId} restaurantId={restaurantId}>{children}</WorkspaceShell>;
}
