import type { Area } from '@pw/shared';

export function AreaSelect(props: { id?: string; value: string; areas: Area[]; onChange: (areaId: string) => void }) {
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.areas.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );
}
