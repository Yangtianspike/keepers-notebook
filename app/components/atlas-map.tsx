"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteSourceFile,
  loadSourceFile,
  saveSourceFile,
} from "@/lib/storage";
import type { AtlasMap, Place, Project, SourceRef } from "@/lib/types";

export function AtlasMapView({
  project,
  onUpdate,
  onOpenSource,
}: {
  project: Project;
  onUpdate: (project: Project) => void;
  onOpenSource: (source: SourceRef) => void;
}) {
  const [selectedMapId, setSelectedMapId] = useState(
    project.analysis.maps[0]?.id ?? "",
  );
  const [placingPlaceId, setPlacingPlaceId] = useState<string | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const selectedMap = project.analysis.maps.find(
    (map) => map.id === selectedMapId,
  );
  const selectedPlace = project.analysis.places.find(
    (place) => place.id === selectedPlaceId,
  );
  useEffect(() => {
    let url = "";
    if (!selectedMap) return;
    loadSourceFile(selectedMap.imageKey).then((blob) => {
      if (blob) {
        url = URL.createObjectURL(blob);
        setImageUrl(url);
      }
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [selectedMap]);
  const save = (changes: Partial<Project["analysis"]>) =>
    onUpdate({
      ...project,
      updatedAt: new Date().toISOString(),
      analysis: { ...project.analysis, ...changes },
    });
  const upload = async (file: File) => {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = async () => {
      URL.revokeObjectURL(url);
      const map: AtlasMap = {
        id,
        name: file.name.replace(/\.[^.]+$/, ""),
        imageKey: `map:${project.id}:${id}`,
        width: image.naturalWidth,
        height: image.naturalHeight,
        createdAt: new Date().toISOString(),
      };
      await saveSourceFile(map.imageKey, file);
      save({ maps: [...project.analysis.maps, map] });
      setSelectedMapId(id);
    };
    image.src = url;
  };
  const addPlace = () => {
    const place: Place = {
      id: crypto.randomUUID(),
      name: "新地点",
      aliases: [],
      summary: "",
      confirmed: true,
      provenance: "keeper",
      sources: [],
    };
    save({ places: [...project.analysis.places, place] });
    setSelectedPlaceId(place.id);
  };
  const pointFor = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };
  const placeMarker = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!placingPlaceId || !selectedMap || !canvasRef.current) return;
    const { x, y } = pointFor(event.clientX, event.clientY);
    save({
      markers: [
        ...project.analysis.markers.filter(
          (marker) =>
            !(
              marker.mapId === selectedMap.id &&
              marker.placeId === placingPlaceId
            ),
        ),
        {
          id: crypto.randomUUID(),
          mapId: selectedMap.id,
          placeId: placingPlaceId,
          x,
          y,
        },
      ],
    });
    setPlacingPlaceId(null);
  };
  const related = useMemo(
    () =>
      selectedPlace
        ? project.analysis.clues.filter((clue) =>
            clue.targets.some(
              (target) =>
                target.type === "place" && target.id === selectedPlace.id,
            ),
          )
        : [],
    [project.analysis.clues, selectedPlace],
  );
  return (
    <div className="atlas-map-view">
      <header className="content-header">
        <div>
          <p className="eyebrow">ATLAS MAP</p>
          <h2>地图与地点</h2>
          <p>上传地图，给地点打点，并从地点回看关联线索。</p>
        </div>
        <label className="primary-button compact">
          上传地图
          <input
            hidden
            type="file"
            accept="image/*"
            onChange={(event) =>
              event.target.files?.[0] && void upload(event.target.files[0])
            }
          />
        </label>
      </header>
      <div className="atlas-layout">
        <aside className="atlas-side">
          <strong>地图</strong>
          {project.analysis.maps.map((map) => (
            <button
              key={map.id}
              className={map.id === selectedMapId ? "active" : ""}
              onClick={() => setSelectedMapId(map.id)}
            >
              {map.name}
            </button>
          ))}
          {selectedMap && (
            <button
              className="text-button"
              onClick={async () => {
                await deleteSourceFile(selectedMap.imageKey);
                save({
                  maps: project.analysis.maps.filter(
                    (map) => map.id !== selectedMap.id,
                  ),
                  markers: project.analysis.markers.filter(
                    (marker) => marker.mapId !== selectedMap.id,
                  ),
                });
                setSelectedMapId("");
              }}
            >
              删除地图
            </button>
          )}
        </aside>
        <section className="atlas-canvas" ref={canvasRef} onClick={placeMarker}>
          {imageUrl ? (
            <img
              /* eslint-disable-line @next/next/no-img-element */ src={imageUrl}
              alt={selectedMap?.name ?? "地图"}
            />
          ) : (
            <p>选择或上传一张地图。</p>
          )}
          {selectedMap &&
            project.analysis.markers
              .filter((marker) => marker.mapId === selectedMap.id)
              .map((marker) => {
                const place = project.analysis.places.find(
                  (item) => item.id === marker.placeId,
                );
                return place ? (
                  <button
                    draggable
                    key={marker.id}
                    className="map-marker"
                    style={{
                      left: `${marker.x * 100}%`,
                      top: `${marker.y * 100}%`,
                    }}
                    onDragEnd={(event) => {
                      const point = pointFor(event.clientX, event.clientY);
                      save({
                        markers: project.analysis.markers.map((item) =>
                          item.id === marker.id ? { ...item, ...point } : item,
                        ),
                      });
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      save({
                        markers: project.analysis.markers.filter(
                          (item) => item.id !== marker.id,
                        ),
                      });
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPlaceId(place.id);
                    }}
                  >
                    ●<span>{place.name}</span>
                  </button>
                ) : null;
              })}
          {placingPlaceId && (
            <b className="map-placement-tip">点击地图放置地点</b>
          )}
        </section>
        <aside className="atlas-side">
          <div>
            <strong>地点</strong>
            <button className="text-button" onClick={addPlace}>
              新增
            </button>
          </div>
          {project.analysis.places.map((place) => (
            <button
              key={place.id}
              className={place.id === selectedPlaceId ? "active" : ""}
              onClick={() => setSelectedPlaceId(place.id)}
            >
              {place.name}
              <small>
                {project.analysis.markers.some(
                  (marker) => marker.placeId === place.id,
                )
                  ? "已落图"
                  : "未落图"}
              </small>
            </button>
          ))}
          {selectedPlace && (
            <div className="place-card">
              <input
                value={selectedPlace.name}
                onChange={(event) =>
                  save({
                    places: project.analysis.places.map((place) =>
                      place.id === selectedPlace.id
                        ? { ...place, name: event.target.value }
                        : place,
                    ),
                  })
                }
              />
              <textarea
                value={selectedPlace.summary}
                onChange={(event) =>
                  save({
                    places: project.analysis.places.map((place) =>
                      place.id === selectedPlace.id
                        ? { ...place, summary: event.target.value }
                        : place,
                    ),
                  })
                }
              />
              <button
                className="primary-button compact"
                onClick={() => setPlacingPlaceId(selectedPlace.id)}
              >
                在地图打点
              </button>
              <small>拖动标记可调整位置，右键可删除。</small>
              <h4>关联线索</h4>
              {related.map((clue) => (
                <p key={clue.id}>{clue.name}</p>
              ))}
              {selectedPlace.sources.map((source, index) => (
                <button
                  className="text-button"
                  key={index}
                  onClick={() => onOpenSource(source)}
                >
                  原文依据 {source.page} 页
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
