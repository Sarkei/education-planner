export type User = { id: number; email: string; name: string; role: string };

export type NodeItem = {
  id: string;
  parentId: string | null;
  name: string;
  kind: 'folder' | 'file';
  mime: string | null;
  size: number;
  version: number;
  ownerId: number;
  shared: boolean;
  permission: 'owner' | 'edit' | 'view';
  updatedAt: string;
  position: number;
};

export type Share = { id: number; user_id: number; name: string; email: string; permission: 'view' | 'edit' };
