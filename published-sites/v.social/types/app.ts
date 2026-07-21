import type { LiveBroadcastMode, LiveBroadcastStatus, ModerationAssignmentLevel, ModerationCaseStatus, PostStatus, Role, Visibility } from "@prisma/client";

export type AppRole = Role;

export type FeedPost = {
  id: string;
  content: string;
  sanitizedContent: string;
  status: PostStatus;
  visibility: Visibility;
  createdAt: Date;
  author: {
    id: string;
    username: string;
    role: Role;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  media: Array<{
    id: string;
    secureUrl: string;
    resourceType: string;
    width: number | null;
    height: number | null;
  }>;
  shareOfPost?: {
    id: string;
    sanitizedContent: string;
    createdAt: Date;
    author: {
      id: string;
      username: string;
      role: Role;
      profile: {
        displayName: string;
        avatarUrl: string | null;
      } | null;
    };
    media: Array<{
      id: string;
      secureUrl: string;
      resourceType: string;
      width: number | null;
      height: number | null;
    }>;
    _count: {
      likes: number;
      comments: number;
      shares: number;
    };
  } | null;
  _count: {
    likes: number;
    comments: number;
    shares: number;
  };
  likedByMe?: boolean;
  liveBroadcast?: {
    id: string;
    mode: LiveBroadcastMode;
    status: LiveBroadcastStatus;
    recordingUrl: string | null;
    recordingPublicId: string | null;
    durationSeconds: number | null;
    startedAt: Date;
    endedAt: Date | null;
    expiresAt: Date | null;
  } | null;
};

export type ModerationOverview = {
  id: string;
  status: ModerationCaseStatus;
  level: ModerationAssignmentLevel;
  postId: string;
  postContent: string;
  reporterUsername: string;
  authorUsername: string;
  level1RemoveVotes: number;
  level2RemoveVotes: number;
  teamRemoveVotes: number;
};
