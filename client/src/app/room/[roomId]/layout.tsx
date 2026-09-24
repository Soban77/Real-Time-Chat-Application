import { RoomLayout } from '@/components/RoomLayout';

interface RoomSegmentLayoutProps {
  children: React.ReactNode;
  params: Promise<{ roomId: string }>;
}

export default async function RoomSegmentLayout({ children, params }: RoomSegmentLayoutProps) {
  const { roomId } = await params;

  return <RoomLayout roomId={roomId}>{children}</RoomLayout>;
}
