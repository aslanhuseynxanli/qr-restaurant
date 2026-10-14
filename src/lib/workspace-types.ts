export type WorkspaceRestaurant={id:string;name:string;slug:string;status:string;is_active:boolean;can_manage:boolean};
export type WorkspaceBranch={id:string;restaurant_id:string;name:string;address:string|null;latitude:number|null;longitude:number|null;allowed_radius_meters:number;accepting_orders:boolean;is_active:boolean;updated_at:string;table_count:number};
export type WorkspaceAssignment={id:string;name:string;restaurant_id:string;restaurant_name:string;staff_kind:"WAITER"|"KITCHEN"};
export type Workspace={active:boolean;name:string;super_admin:boolean;restaurants:WorkspaceRestaurant[];branches:WorkspaceBranch[];assignments:WorkspaceAssignment[]};
export function assignmentPath(assignment:WorkspaceAssignment){return `/admin/restaurants/${assignment.restaurant_id}/branches/${assignment.id}/${assignment.staff_kind==="KITCHEN"?"kitchen":"orders"}`;}
