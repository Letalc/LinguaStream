import Image from "next/image";

type NeonIconProps = {
  className?: string;
  alt?: string;
  title?: string;
};

function makeNeonIcon(name: string) {
  function NeonIcon({ className, alt = "", title }: NeonIconProps) {
    return (
      <Image
        src={`/icons/neon/${name}.png`}
        width={256}
        height={256}
        alt={alt}
        title={title}
        className={`shrink-0 object-contain ${className ?? ""}`}
        draggable={false}
      />
    );
  }
  NeonIcon.displayName = name;
  return NeonIcon;
}

export const AArrowDown = makeNeonIcon("AArrowDown");
export const AArrowUp = makeNeonIcon("AArrowUp");
export const Accessibility = makeNeonIcon("Accessibility");
export const Archive = makeNeonIcon("Archive");
export const ArrowLeft = makeNeonIcon("ArrowLeft");
export const AudioLines = makeNeonIcon("AudioLines");
export const Bell = makeNeonIcon("Bell");
export const BellOff = makeNeonIcon("BellOff");
export const Check = makeNeonIcon("Check");
export const ChevronDown = makeNeonIcon("ChevronDown");
export const CircleAlert = makeNeonIcon("CircleAlert");
export const Contrast = makeNeonIcon("Contrast");
export const Copy = makeNeonIcon("Copy");
export const Download = makeNeonIcon("Download");
export const Ear = makeNeonIcon("Ear");
export const ExternalLink = makeNeonIcon("ExternalLink");
export const FileText = makeNeonIcon("FileText");
export const FolderClosed = makeNeonIcon("FolderClosed");
export const FolderOpen = makeNeonIcon("FolderOpen");
export const Hand = makeNeonIcon("Hand");
export const Languages = makeNeonIcon("Languages");
export const LogOut = makeNeonIcon("LogOut");
export const Mic = makeNeonIcon("Mic");
export const MonitorSpeaker = makeNeonIcon("MonitorSpeaker");
export const Pause = makeNeonIcon("Pause");
export const Play = makeNeonIcon("Play");
export const Presentation = makeNeonIcon("Presentation");
export const QrCode = makeNeonIcon("QrCode");
export const Radio = makeNeonIcon("Radio");
export const RotateCw = makeNeonIcon("RotateCw");
export const Share2 = makeNeonIcon("Share2");
export const Sparkles = makeNeonIcon("Sparkles");
export const Square = makeNeonIcon("Square");
export const Trash2 = makeNeonIcon("Trash2");
export const TriangleAlert = makeNeonIcon("TriangleAlert");
export const Upload = makeNeonIcon("Upload");
export const Vibrate = makeNeonIcon("Vibrate");
export const Volume2 = makeNeonIcon("Volume2");
export const VolumeX = makeNeonIcon("VolumeX");
export const WifiOff = makeNeonIcon("WifiOff");
export const X = makeNeonIcon("X");
