package com.shantu.nativeapp

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.WindowInsets
import android.view.MotionEvent
import android.view.GestureDetector
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.Toast
import com.shantu.nativeapp.data.WorkspaceStore
import com.shantu.nativeapp.data.CollectionRecordRef
import com.shantu.nativeapp.data.NativeSourceImport
import com.shantu.nativeapp.ui.NativeSourceEditor
import com.shantu.nativeapp.ui.NativeDualMapPanel
import com.shantu.nativeapp.ui.NativeDualMapChoice
import com.shantu.nativeapp.ui.NativeDualMapGroup
import com.shantu.nativeapp.ui.NativeCadPanel
import com.shantu.nativeapp.cad.NativeDxfImporter
import com.shantu.nativeapp.map.NativeMapController
import com.shantu.nativeapp.map.NativeMapSourceCatalog
import com.shantu.nativeapp.map.NativeMapQuality
import com.shantu.nativeapp.data.NativeRouteFormats
import com.shantu.nativeapp.recording.RecordingFacade
import com.shantu.nativeapp.recording.RecordedTrackConversion
import com.shantu.nativeapp.ui.HomeChrome
import com.shantu.nativeapp.ui.ShantuColors
import com.shantu.nativeapp.ui.NativeObjectEditor
import com.shantu.nativeapp.ui.NativeRoutePanel
import com.shantu.nativeapp.ui.NativeGeometryPanel
import com.shantu.nativeapp.ui.NativeCollectionPanel
import com.shantu.nativeapp.ui.NativeCachePanel
import com.shantu.nativeapp.ui.NativeSamplingPanel
import com.shantu.nativeapp.ui.NativeNavigationPanel
import com.shantu.nativeapp.ui.NativePhotoPanel
import com.shantu.nativeapp.photos.NativePhotoImporter
import com.shantu.nativeapp.photos.NativePhotoMatching
import com.shantu.nativeapp.map.NativeCacheManager
import com.shantu.nativeapp.map.NativeCacheSource
import com.shantu.nativeapp.navigation.NativePlaceSearch
import com.shantu.nativeapp.navigation.NativePlace
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** Native validation application. No WebView, HTML surface or JavaScript runtime. */
class MainActivity : Activity(), LocationListener, android.hardware.SensorEventListener {
    private lateinit var map: NativeMapController
    private lateinit var mapRoot: FrameLayout
    private var secondaryMap:NativeMapController?=null
    private var comparisonPanel:NativeDualMapPanel?=null
    private var comparisonActive=false
    private var activePane=0
    private var drawingMap:NativeMapController?=null
    private val comparisonTick=object:Runnable {
        override fun run() {
            if(destroyed||!comparisonActive)return
            val active=if(activePane==0)map else secondaryMap ?: map
            comparisonPanel?.onCameraChanged(activePane,active.cameraSnapshot())
            handler.postDelayed(this,200)
        }
    }
    private lateinit var chrome: HomeChrome
    private lateinit var store: WorkspaceStore
    private lateinit var locationManager: LocationManager
    private val handler = Handler(Looper.getMainLooper())
    private val filesExecutor = Executors.newSingleThreadExecutor()
    private val searchExecutor = Executors.newSingleThreadExecutor()
    private var searchTask: java.util.concurrent.Future<*>? = null
    private var searchCancellation: android.os.CancellationSignal? = null
    private var searchGeneration = 0
    private var searchQuery = ""
    private var exportFormat = NativeRouteFormats.Format.GPX
    private var pendingCameraFile: String? = null
    private lateinit var placeSearch: NativePlaceSearch
    private val offlineRouting by lazy { com.shantu.nativeapp.offlineRouting.NativeOfflineRouting(this) }
    private val offlineRoutes by lazy { com.shantu.nativeapp.offlineRouting.NativeOfflineRouteProvider(offlineRouting) }
    private val routePlanner by lazy { com.shantu.nativeapp.navigation.NativeRoutePlanner(offlineProvider={stops,cancel->offlineRoutes.route(stops,cancel)},defaultRoutingPreference={preferences.getString("routing-preference","online")?:"online"}) }
    private var offlineRoutingPanel:com.shantu.nativeapp.ui.NativeOfflineRoutingPanel?=null
    private val offlineMapStore by lazy{com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore(this)}
    private val legacyArchive by lazy{com.shantu.nativeapp.offlineMaps.NativeLegacyOfflineArchive(this)}
    private var offlineMapsPanel:com.shantu.nativeapp.ui.NativeOfflineMapsPanel?=null
    private var taskMigrationPanel:com.shantu.nativeapp.ui.NativeTaskMigrationPanel?=null
    private var pendingGeorefImage:android.net.Uri?=null
    private var pendingWorldFile=""
    private lateinit var routePanel: NativeRoutePanel
    private lateinit var geometryPanel: NativeGeometryPanel
    private lateinit var collectionPanel: NativeCollectionPanel
    private lateinit var cachePanel: NativeCachePanel
    private lateinit var navigationPanel: NativeNavigationPanel
    private lateinit var photoPanel: NativePhotoPanel
    private lateinit var industryPanel:com.shantu.nativeapp.ui.NativeIndustryPanel
    private var industryKind="section"
    private var documentExportFile:String?=null
    private var sectionPanel:com.shantu.nativeapp.ui.NativeSectionPanel?=null
    private var surveyPanel:com.shantu.nativeapp.ui.NativeSurveySectionPanel?=null
    private var surveyPicking=false
    private var sectionSurface:com.shantu.nativeapp.section.NativeSectionSurfaceLayer?=null
    private lateinit var cadPanel:NativeCadPanel
    private var sourceEditor: NativeSourceEditor? = null
    private var objectGizmo:com.shantu.nativeapp.ui.NativeObjectGizmo?=null
    private var layoutEditor:com.shantu.nativeapp.ui.NativeLayoutEditor?=null
    private var mergedSourceDefinitions = JSONArray()
    private var tiandituKey = ""
    private var placeSelection: ((NativePlace) -> Unit)? = null
    private var privateSourceDefinitions = JSONArray()
    private val publicSourceDefinitions by lazy { JSONObject(assets.open("public-map-sources.json").bufferedReader().use { it.readText() }).getJSONArray("maps") }
    private val publicSourceCatalog by lazy { NativeMapSourceCatalog.fromJson(JSONObject().put("maps",publicSourceDefinitions)) }
    private var sourceCatalog = NativeMapSourceCatalog(emptyList(), emptyList())
    private var terrain = false
    private var geologyState=com.shantu.nativeapp.geology.NativeGeologyState()
    private var geologyPanel:com.shantu.nativeapp.ui.NativeGeologyPanel?=null
    private var geologyCredentials:com.shantu.nativeapp.geology.NativeGeologyCredentials?=null
    private var contours=false
    private var elevationColors=false
    private var contourInterval=30
    private var follow = false
    private var gestureActive = false
    private var gestureStartHeading:Double?=null
    private var lastLocation: Location? = null
    private val motionHeading = com.shantu.nativeapp.map.NativeMotionHeading()
    private var directionMode = com.shantu.nativeapp.map.NativeDirectionMode.FREE
    private var compassHeading: Double? = null
    private var compassAt = 0L
    private var sensorActive = false
    private var foreground = false
    private val sensorManager by lazy { getSystemService(SENSOR_SERVICE) as android.hardware.SensorManager }
    private var pendingPermissionAction: String? = null
    private var pendingNavigationRecord = false
    private var drawing = false
    private lateinit var nativeDrawing:com.shantu.nativeapp.ui.NativeDrawingPanel
    private var drawingPreview:JSONObject?=null
    private val drawingIds=mutableSetOf<String>()
    private val objectRefs=linkedMapOf<String,CollectionRecordRef>()
    private var collectionPreview=emptyMap<CollectionRecordRef,JSONObject>()
    private var boxOverlay:com.shantu.nativeapp.ui.NativeBoxSelectionView?=null
    private var boxRefs=emptyList<CollectionRecordRef>()
    private var boxPending=false
    private var boxPickGeneration=0
    private var destroyed = false
    private var incomingHandled=false
    private var lastLoadingDiagnosticAt = 0L
    private val preferences by lazy { getSharedPreferences("native-ui-v1", MODE_PRIVATE) }
    private val refreshRecording = object : Runnable {
        override fun run() {
            if (destroyed) return
            if (::map.isInitialized) chrome.scaleBar.update(map.groundMetersAcross(chrome.dp(44).toFloat()))
            if (::map.isInitialized) updatePosition()
            if (::map.isInitialized){map.refreshModelTerrain();secondaryMap?.refreshModelTerrain()}
            val diagnosticTime = android.os.SystemClock.elapsedRealtime()
            if (::map.isInitialized && applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0 &&
                diagnosticTime - lastLoadingDiagnosticAt >= 5000L) {
                lastLoadingDiagnosticAt = diagnosticTime
                android.util.Log.i("ShantuNativeMap", "renderer=WorldWind; ${map.loadingSnapshot()}")
            }
            runCatching {
                val state = RecordingFacade.snapshot(this@MainActivity)
                chrome.quickRecord.text = when (state.optString("phase")) {
                    "recording" -> "Ⅱ\n暂停"
                    "paused" -> "▶\n继续"
                    "finished" -> "▣\n保存"
                    else -> "▶\n开始"
                }
                if (chrome.currentPanel() == "record") {
                    chrome.findViewWithTag<android.widget.TextView>("record-summary")?.text = recordingSummary(state)
                }
                if (chrome.locked && state.optString("phase") in listOf("recording", "paused")) chrome.status.text = recordingSummary(state)
            }
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        incomingHandled=savedInstanceState?.getBoolean("incomingHandled") ?: false
        pendingCameraFile = savedInstanceState?.getString("pendingCameraFile")
        industryKind=savedInstanceState?.getString("industryKind") ?: "section"
        documentExportFile=savedInstanceState?.getString("documentExportFile")
        exportFormat = runCatching { NativeRouteFormats.Format.valueOf(savedInstanceState?.getString("exportFormat") ?: "GPX") }.getOrDefault(NativeRouteFormats.Format.GPX)
        val root = FrameLayout(this).apply { setBackgroundColor(Color.rgb(32, 59, 63)) }
        mapRoot=root
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false)
            root.setOnApplyWindowInsetsListener { _, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                root.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, insets.getInsets(WindowInsets.Type.ime()).bottom))
                WindowInsets.CONSUMED
            }
        }
        setContentView(root)
        chrome = HomeChrome(this, ::perform)
        chrome.onOpenLayoutEditor=::openLayoutEditor
        val privateConfig = runCatching { assets.open("native-private-config.json").bufferedReader().use { JSONObject(it.readText()) } }.getOrNull()
        val key = privateConfig?.optString("tiandituKey").orEmpty()
        tiandituKey = key
        privateConfig?.optJSONObject("geocloud")?.let{cfg->cfg.optString("token").takeIf{it.isNotBlank()}?.let{token->geologyCredentials=com.shantu.nativeapp.geology.NativeGeologyCredentials(token,cfg.optString("service","qg20_20210401_FCnDDRJd"),cfg.optString("layer"))}}
        placeSearch = NativePlaceSearch(key)
        privateSourceDefinitions = privateConfig?.optJSONArray("mapSources") ?: JSONArray()
        if (key.isBlank()) {
            root.addView(chrome)
            chrome.status.text = "天地图私人配置缺失，请使用已核验的私人构建。"
            return
        }
        store = WorkspaceStore(this)
        applySavedAppearance()
        reloadSourceCatalog()
        locationManager = getSystemService(LOCATION_SERVICE) as LocationManager
        map = NativeMapController(this, key) { message -> runOnUiThread { if (!destroyed) chrome.status.text = message } }
        chrome.registerCameraJoystick(com.shantu.nativeapp.ui.NativeCameraJoystick(this,onCameraInput={heading,pitch->
            if(kotlin.math.abs(heading)>.001f)freeCameraDirection()
            val target=if(comparisonActive&&activePane==1)secondaryMap?:map else map
            val camera=target.cameraSnapshot();target.setHeading(camera.headingDegrees+heading);target.setPitch(camera.pitchDegrees+pitch)
        },onGestureState={active->gestureActive=active;if(!active&&follow)lastLocation?.let(::onLocationChanged)}))
        runCatching{preferences.getString("layout",null)?.let{chrome.setLayoutDraft(com.shantu.nativeapp.layout.NativeLayoutDraft.parse(it))}}
        configureGeology(map,true)
        directionMode=runCatching { com.shantu.nativeapp.map.NativeDirectionMode.valueOf(preferences.getString("direction-mode","FREE")!!) }.getOrDefault(com.shantu.nativeapp.map.NativeDirectionMode.FREE)
        navigationPanel = NativeNavigationPanel(this,chrome,map,onFollow = { requireLocation("follow") },onStop = { follow=false },planner=routePlanner)
        routePanel = NativeRoutePanel(this, chrome, map, store,
            search = { selected -> placeSelection = selected; coordinateSearch() },
            locate = {
                val location = lastLocation
                if (location != null && System.currentTimeMillis() - location.time in 0..20000)
                    NativePlace("当前位置", location.longitude, location.latitude)
                else { requireLocation("follow"); null }
            }, onSaved = { renderWorkspace(); collections() }, onNavigate = ::startNavigation,
            onShowRoute={viewTrack(plannedTrack(it))},
            onShareRoute={planned->
                val track=plannedTrack(planned)
                val bytes=NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX,JSONObject().put("core",JSONObject().put("tracks",JSONArray().put(track))))
                shareBytes(bytes,"山兔规划路线.gpx","application/gpx+xml")
            },
            onCacheRoute={cachePanel.create(it.coordinates.map {p->p.longitude to p.latitude},"规划路线")},
            onEditRoute={nativeDrawing.continueFrom(plannedTrack(it))},planner=routePlanner)
        geometryPanel = NativeGeometryPanel(this, chrome, map, store, ::renderWorkspace,onExportProfileImage=::saveProfilePng)
        collectionPanel = NativeCollectionPanel(this, chrome, store, ::objectDetails, ::importFile, ::exportFile,
            onShare=::shareSelection,onChanged=::renderWorkspace,
            mapCenter={map.cameraSnapshot().let {it.longitude to it.latitude}},
            onOpenCache={cachePanel.show()},onCacheRecords=::cacheSelection,
            onPreviewTransform={values->collectionPreview=values;renderWorkspace()},onClearTransformPreview={collectionPreview=emptyMap();renderWorkspace()})
        cachePanel = NativeCachePanel(this, chrome, map, NativeCacheManager(this, map.tileNetwork()), ::cacheSources)
        photoPanel = NativePhotoPanel(this,chrome,onPickPhoto=::pickPhoto,onTakePhoto=::takePhoto,onSharePhoto=::sharePhoto,onSavePhoto=::savePhoto,onUpdatePhoto=::savePhoto,onDeletePhoto={ id ->
            runCatching { store.remove("photos",id) }.onSuccess { refreshPhotos(); photoPanel.show(); renderWorkspace() }.onFailure { toast("照片未删除，存档保留") }
        })
        refreshPhotos()
        cadPanel=NativeCadPanel(this,chrome,onPickFile={ startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type="*/*";addCategory(Intent.CATEGORY_OPENABLE) },109) },
            onSave=::saveCad,onUpdate={ if(!saveCad(it))error("工程图保存失败") },
            onDelete={ id -> store.remove("cadDocuments",id);refreshCad();renderWorkspace() },
            onView={ doc ->
                val f=doc.getJSONArray("mapFeatures").optJSONObject(0)?.getJSONObject("geometry")
                val coords=f?.getJSONArray("coordinates")
                val point=when(f?.optString("type")){"Point"->coords;"LineString"->coords?.optJSONArray(0);"Polygon"->coords?.optJSONArray(0)?.optJSONArray(0);else->null}
                point?.let { map.centerTo(it.getDouble(1),it.getDouble(0)) };chrome.closePanel()
            },onExport={ doc ->
                runCatching { java.util.Base64.getDecoder().decode(doc.getString("sourceBase64")) }
                    .onSuccess { shareBytes(it,doc.getString("name"),"application/octet-stream") }.onFailure { toast("原始CAD文件无法读取") }
            })
        refreshCad()
        industryPanel=com.shantu.nativeapp.ui.NativeIndustryPanel(this,chrome,onPickFile={
            AlertDialog.Builder(this).setTitle("导入行业工作簿").setItems(arrayOf("实测剖面 XLSX","钻孔柱状图 XLSX")) {_,index->
                industryKind=if(index==0)"section" else "drill"
                startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {type="*/*";addCategory(Intent.CATEGORY_OPENABLE)},111)
            }.show()
        },onSave={project->
            val success=runCatching {store.upsert("industryProjects",project)}.isSuccess
            if(success)refreshIndustry() else toast("行业项目未保存，原数据保留")
            success
        },onOpen={project->
            runCatching {java.util.Base64.getDecoder().decode(project.getString("sourceBase64"))}
                .onSuccess {loadIndustry(project.getString("kind"),project.getString("name"),it,project)}.onFailure {toast("原始工作簿无法读取")}
        },onDelete={id->runCatching {store.remove("industryProjects",id)}.onSuccess {refreshIndustry();industryPanel.show()}.onFailure {toast("删除未完成")}},
        onExport={bytes,name,mime->prepareDocumentExport(bytes,name,mime)},
        onShare={bytes,name,mime->shareBytes(bytes,name,mime)})
        refreshIndustry()
        chrome.status.contentDescription = "地图加载状态，点击重试未完成的瓦片"
        chrome.status.setOnClickListener { map.retryPendingTiles() }
        val savedDrawing=preferences.getString("drawing-draft",null)?.let { raw ->
            runCatching { JSONObject(raw) }.getOrElse { JSONObject().put("format","unreadable-json").put("rawDraft",raw) }
        }
        drawingPreview=savedDrawing?.let { runCatching { com.shantu.nativeapp.drawing.NativeDrawingState.restore(it).snapshot() }.getOrNull() }
        nativeDrawing=com.shantu.nativeapp.ui.NativeDrawingPanel(this,chrome,initialDraft=savedDrawing,planner=routePlanner,
            callbacks=com.shantu.nativeapp.ui.NativeDrawingCallbacks(
                onRequestMapPoint={ enabled ->drawing=enabled;chrome.setTaskActive(enabled) },
                onRender={ track -> drawingPreview=track;renderDrawingPreview() },
                onDraftChanged={ value ->
                    if(value==null) {preferences.edit().remove("drawing-draft").apply();drawingPreview=null;renderDrawingPreview()}
                    else preferences.edit().putString("drawing-draft",value.toString()).apply()
                },
                onSave={ track ->
                    val saved=runCatching {store.upsert("tracks",track)}.isSuccess
                    if(saved){runCatching {renderWorkspace()};toast("线条已保存")}else toast("保存失败，草稿保留")
                    saved
                },onClose={drawing=false;chrome.setTaskActive(false)},
                onDiscardDamagedDraft={
                    // Only the explicit discard control authorizes replacing this recovery copy.
                    preferences.edit().remove("drawing-draft").apply()
                },onSnapRiver={from,to,cancel->com.shantu.nativeapp.navigation.NativeRiverSnapService().snap(from,to,cancel)}
            ))
        val taps = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapConfirmed(event: MotionEvent): Boolean {
                if(surveyPicking){map.screenToCoordinate(event.x,event.y)?.let{surveyPanel?.onMapPoint(it.second,it.first)};return true}
                if (!drawing && !geometryPanel.acceptingMapPoints) {
                    pickObject(map,event.x,event.y);return false
                }
                val point = map.screenToCoordinate(event.x, event.y) ?: return false
                if (kotlin.math.abs(point.first) > 85) { toast("选点超出当前工具支持范围"); return true }
                if (geometryPanel.acceptingMapPoints) geometryPanel.addMapPoint(point.first, point.second)
                else if (drawing) nativeDrawing.onMapPoint(point.second,point.first)
                return true
            }
        })
        val freehand=freehandInput(map)
        map.view.setOnTouchListener { _, event ->
            if(comparisonActive && event.actionMasked==MotionEvent.ACTION_DOWN) { activePane=0;comparisonPanel?.setActivePane(0);drawingMap=map }
            val drawingStroke=freehand.onTouch(event)
            if(!drawingStroke)taps.onTouchEvent(event)
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {gestureActive=true;gestureStartHeading=map.cameraSnapshot().headingDegrees}
                MotionEvent.ACTION_POINTER_DOWN -> gestureActive = true
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    gestureActive = false
                    handler.post { if (!destroyed) {
                        gestureStartHeading?.let{initial->if(kotlin.math.abs((map.cameraSnapshot().headingDegrees-initial+540)%360-180)>.5)freeCameraDirection()};gestureStartHeading=null
                        if(follow)lastLocation?.let(::onLocationChanged)
                    } }
                }
            }
            drawingStroke
        }
        root.addView(map.view, FrameLayout.LayoutParams(-1, -1))
        chrome.onMapViewportChanged = { top, bottom ->
            if(!comparisonActive) map.view.layoutParams = FrameLayout.LayoutParams(-1,-1).apply { topMargin=top; bottomMargin=bottom }
        }
        root.addView(chrome, FrameLayout.LayoutParams(-1, -1))
        chrome.addOnLayoutChangeListener { _,l,t,r,b,ol,ot,or,ob ->
            if(comparisonActive&&(r-l!=or-ol||b-t!=ob-ot)) comparisonPanel?.resize(r-l,b-t)
        }
        runCatching {
            val camera = preferences.getString("camera", null)?.let(::JSONObject)
            if(camera==null)preferences.getString("legacy-view",null)?.let{raw->map.view.post{if(!destroyed)map.restoreLegacyView(JSONObject(raw))}}
            if (camera != null) map.restoreCamera(com.shantu.nativeapp.map.NativeCameraSnapshot(
                camera.getDouble("latitude"), camera.getDouble("longitude"), camera.getDouble("range"), camera.getDouble("heading"), camera.getDouble("pitch")))
            val selected = preferences.getString("source", NativeMapController.SOURCE_IMAGERY)!!
            if (selected in NativeMapController.SOURCE_IDS) map.setSource(selected)
            else (sourceCatalog.sources+publicSourceCatalog.sources).find { it.id == selected }?.let(map::setCustomSource)
                ?: run { chrome.status.text = "原选择图源当前不可用，请在图源列表核对" }
            map.setQuality(if (preferences.getString("quality", "high") == "standard") NativeMapQuality.STANDARD else NativeMapQuality.HIGH)
            applyRasterPreferences(map)
            contours=preferences.getBoolean("contours",false);elevationColors=preferences.getBoolean("elevation-colors",false)
            contourInterval=preferences.getInt("contour-interval",30).takeIf { it in setOf(30,50,100,200) } ?: 30
            map.setTerrainOverlay(contours,elevationColors,contourInterval)
            terrain=preferences.getBoolean("terrain",true);map.setTerrain(terrain);chrome.setTerrainButton(terrain)
            map.setTerrainExaggeration(preferences.getFloat("terrain-exaggeration",1f).toDouble())
            renderWorkspace()
            renderDrawingPreview()
        }.onFailure { chrome.status.text = "部分原生存档未能读取，原文件已保留。" }
        handler.post(refreshRecording)
        if(!incomingHandled)handler.post {offerIncomingDocument(intent)}
    }

    private fun perform(action: String) {
        if(chrome.currentPanel()=="layout-editor"){layoutEditor?.dispose();layoutEditor=null}
        if (!::map.isInitialized) return
        when (action) {
            "+" -> map.zoomBy(1.0)
            "−" -> map.zoomBy(-1.0)
            "terrain" -> { terrain = !terrain;preferences.edit().putBoolean("terrain",terrain).apply(); map.setTerrain(terrain);secondaryMap?.setTerrain(terrain); map.setPitch(if (terrain) 50.0 else 0.0); chrome.setTerrainButton(terrain) }
            "favorite-source" -> favoriteSources()
            "layers" -> layers()
            "direction" -> direction()
            "follow" -> if (follow) { follow = false; navigationPanel.setFollowing(false); chrome.status.text = "已取消定位跟随" } else requireLocation("follow")
            "record" -> recording()
            "record-quick" -> {
                val phase = RecordingFacade.snapshot(this).optString("phase")
                when (phase) { "recording" -> recordCommand("pause"); "paused" -> requireLocation("resume"); "finished" -> saveRecording(); else -> requireLocation("start") }
            }
            "favorite" -> collections()
            "draw" -> { geometryPanel.stopPicking(); drawingPanel() }
            "marker" -> markerPanel()
            "search" -> { placeSelection = null; coordinateSearch() }
            "tools" -> toolsPanel()
            "route" -> if (navigationPanel.isActive()) navigationPanel.show() else routePanel.show()
            "quality" -> qualityPanel()
            "box" -> openBoxSelection()
            "about" -> AlertDialog.Builder(this).setTitle("山兔 · 原生验证")
                .setMessage("当前为原生重建的独立验证工程，尚未达到旧版全部功能与界面一致。现有旧版和数据继续保留。\n\n地图：天地图\n原生引擎：WorldWind Kotlin\n地形及专业功能正在逐项接入验证。")
                .setPositiveButton("关闭", null).show()
        }
    }

    private fun reloadSourceCatalog() {
        val definitions = linkedMapOf<String, JSONObject>()
        fun add(values: JSONArray) {
            for (i in 0 until values.length()) {
                val item = values.optJSONObject(i) ?: continue
                val identity = item.optString("id").ifBlank {
                    java.security.MessageDigest.getInstance("SHA-256").digest(item.toString().toByteArray()).joinToString("") { "%02x".format(it) }
                }
                definitions[identity] = item
            }
        }
        val workspace=store.load()
        val offlineMaps=com.shantu.nativeapp.offlineMaps.NativeOfflineMapStore(this).list()
        offlineMaps.forEach{m->definitions[m.id]=JSONObject().put("id",m.id).put("name",m.name).put("kind",m.kind).put("format",m.format).put("filePath",m.filePath).put("minzoom",m.minZoom).put("maxzoom",m.maxZoom).put("bounds",m.bounds?.let(::JSONArray)).put("attribution",m.attribution).put("bytes",m.bytes).put("tileSize",256)}
        if(!workspace.optBoolean("nativeSourceCatalogManaged")) add(privateSourceDefinitions)
        val saved = workspace.optJSONArray("mapSources") ?: JSONArray()
        add(saved)
        val bindings=runCatching{JSONObject(preferences.getString("offline-map-bindings","{}")!!)}.getOrDefault(JSONObject())
        bindings.keys().forEach{originalId->val binding=bindings.optJSONObject(originalId);val local=offlineMaps.firstOrNull{it.id==binding?.optString("nativeId")}
            if(local!=null){definitions[originalId]=JSONObject().put("id",originalId).put("name",local.name).put("kind",local.kind).put("format",local.format).put("filePath",local.filePath).put("bounds",local.bounds?.let(::JSONArray)).put("minzoom",local.minZoom).put("maxzoom",local.maxZoom).put("tileSize",256).put("bytes",local.bytes).put("attribution",local.attribution);definitions.remove(local.id)}
        }
        val datumOverrides=runCatching{JSONObject(preferences.getString("source-coordinates","{}")!!)}.getOrDefault(JSONObject())
        definitions.forEach{(id,value)->val override=datumOverrides.optString("custom:$id");if(override in listOf("wgs84","gcj02","bd09"))value.put("datum",override)}
        mergedSourceDefinitions=JSONArray(definitions.values.toList())
        sourceCatalog = NativeMapSourceCatalog.fromJson(JSONObject().put("maps", mergedSourceDefinitions))
    }

    private fun editSources() {
        val editor=NativeSourceEditor(this,JSONObject().put("maps",mergedSourceDefinitions),onSave={ configuration ->
            runCatching { store.replaceMapSources(configuration.getJSONArray("maps")) }.onSuccess {
                reloadSourceCatalog()
                val id=map.currentCustomSource()?.id
                if(id!=null && publicSourceCatalog.sources.none { it.id==id }) {
                    val selected=sourceCatalog.sources.firstOrNull { it.id==id }
                    if(selected!=null) map.setCustomSource(selected) else { map.setSource(NativeMapController.SOURCE_IMAGERY);preferences.edit().putString("source",NativeMapController.SOURCE_IMAGERY).apply() }
                }
                sources(1);toast("图源已保存")
            }.onFailure { toast("图源保存失败，原目录保留") }
        },onImportRequested={
            AlertDialog.Builder(this).setTitle("导入图源").setItems(arrayOf("选择 JSON / OVMAP 文件","扫描二维码 / 从图片识别")) {_,which ->
                if(which==0)startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type="*/*";addCategory(Intent.CATEGORY_OPENABLE) },108)
                else startActivityForResult(Intent(this,com.shantu.nativeapp.ui.NativeQrActivity::class.java),110)
            }.show()
        },onClose={ sources(1) })
        sourceEditor=editor
        chrome.showPanelWithSlots("source-editor","管理图源",topAligned=true,width=320,maxHeightDp=480,
            fixedHeader={},fixedFooter={}) {
            addView(editor.view,LinearLayout.LayoutParams(-1,chrome.dp(minOf(450,(chrome.height/chrome.resources.displayMetrics.density).toInt()-180).coerceAtLeast(180))))
        }
    }
    private fun importSourceFile(uri:android.net.Uri) {
        val editor=sourceEditor ?: return
        filesExecutor.execute {
            val result=runCatching {
                val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { if(it.moveToFirst())it.getString(0) else null } ?: "图源.json"
                val bytes=contentResolver.openInputStream(uri)?.use { NativePhotoImporter.readBounded(it,NativeSourceImport.MAX_CONFIG_BYTES) } ?: error("无法读取")
                NativeSourceImport.importFile(name,bytes)
            }
            handler.post { if(!destroyed && sourceEditor===editor) result.onSuccess { parsed ->
                val update=editor.acceptImport(parsed)
                toast(update.message)
            }.onFailure { toast("图源未导入：文件格式、内容校验或大小限制未通过；已有图源保留") } }
        }
    }

    private fun favoriteSourceKey(id: String): String = when(id) {
        NativeMapController.SOURCE_IMAGERY -> "tdt-img"
        NativeMapController.SOURCE_VECTOR -> "tdt-vec"
        NativeMapController.SOURCE_TERRAIN -> "tdt-ter"
        else -> if(id.startsWith("builtin-")) "public:$id" else "saved:$id"
    }
    private fun sourceFavorites(): Set<String> {
        preferences.getStringSet("source-favorites",null)?.let { return it.toSet() }
        val raw=store.load().optJSONObject("settings")?.optString("shantu-map-source-favorites-v1","[]") ?: "[]"
        return runCatching { val values=JSONArray(raw); (0 until values.length()).map { values.getString(it) }.toSet() }.getOrDefault(emptySet())
    }
    private fun sourceRow(label: String,id: String,choose:()->Unit): LinearLayout = LinearLayout(this).apply {
        val key=favoriteSourceKey(id)
        addView(chrome.row((if(map.currentSource()?.id==id) "✓ " else "")+label,choose),LinearLayout.LayoutParams(0,chrome.dp(30),1f))
        addView(chrome.textButton(if(key in sourceFavorites()) "★" else "☆",18) {
            val next=sourceFavorites().toMutableSet(); if(!next.add(key)) next.remove(key)
            preferences.edit().putStringSet("source-favorites",next).apply()
            sources(preferences.getInt("source-tab",0))
        }.apply { setTextColor(ShantuColors.accent); minimumHeight=0 },LinearLayout.LayoutParams(chrome.dp(32),chrome.dp(30)))
    }
    private fun selectSource(id: String) {
        if(id in NativeMapController.SOURCE_IDS) map.setSource(id)
        else (sourceCatalog.sources+publicSourceCatalog.sources).firstOrNull { it.id==id }?.let(map::setCustomSource) ?: return
        preferences.edit().putString("source",id).apply(); chrome.closePanel()
    }
    private fun favoriteSources() {
        val favorites=sourceFavorites()
        if(favorites.isEmpty()) { sources(preferences.getInt("source-tab",0)); return }
        chrome.showPanel("sources","收藏的图源",topAligned=true) {
            val builtin=listOf(NativeMapController.SOURCE_IMAGERY to "天地图影像",NativeMapController.SOURCE_VECTOR to "天地图矢量",NativeMapController.SOURCE_TERRAIN to "天地图地形")
            for((id,name) in builtin+(sourceCatalog.sources+publicSourceCatalog.sources).map { it.id to it.name })
                if(favoriteSourceKey(id) in favorites) addView(sourceRow(name,id) { selectSource(id) })
            addView(chrome.row("管理全部图源") { sources(preferences.getInt("source-tab",0)) })
        }
    }
    private fun sources(tab: Int = 0): Unit = chrome.showPanel("sources", "地图图源", topAligned = true) {
        preferences.edit().putInt("source-tab",tab).apply()
        val tabs = LinearLayout(this@MainActivity)
        listOf("内置", "我的图源", "公共库").forEachIndexed { index, name ->
            tabs.addView(chrome.textButton(name) { sources(index) }
                .apply { if (index == tab) setTextColor(ShantuColors.accent) }, LinearLayout.LayoutParams(0, chrome.dp(28), 1f))
        }
        addView(tabs)
        if (tab == 1) {
            addView(chrome.row("添加 / 编辑 / 导入图源") { editSources() })
            sourceCatalog.sources.forEach { source ->
                addView(sourceRow(source.name,source.id) { selectSource(source.id) })
            }
            sourceCatalog.errors.forEach { error -> addView(chrome.text("第${error.index + 1}个图源：${error.reason}", 11)) }
            addView(chrome.row("从完整工程导入图源") { importFile() })
            return@showPanel
        }
        if (tab == 2) {
            val selectedCategory=preferences.getString("source-region","全球") ?: "全球"
            val categories=LinearLayout(this@MainActivity)
            for(category in listOf("全球","美国","日本")) categories.addView(chrome.textButton(category) {
                preferences.edit().putString("source-region",category).apply(); sources(2)
            }.apply { if(category==selectedCategory) setTextColor(ShantuColors.accent) },LinearLayout.LayoutParams(0,chrome.dp(28),1f))
            addView(categories)
            for(i in 0 until publicSourceDefinitions.length()) {
                val record=publicSourceDefinitions.getJSONObject(i)
                if(record.optString("category")!=selectedCategory) continue
                val id=record.getString("id")
                addView(sourceRow(record.getString("name"),id) { selectSource(id) })
                addView(chrome.text("最高 ${record.getInt("maxzoom")} 级 · ${record.optString("detail")}",11))
                addView(chrome.row("来源与说明") {
                    AlertDialog.Builder(this@MainActivity).setTitle(record.getString("name"))
                        .setMessage(record.optString("attribution")+"\n"+record.optString("detail"))
                        .setPositiveButton("查看来源") { _,_ -> runCatching { startActivity(Intent(Intent.ACTION_VIEW,android.net.Uri.parse(record.getString("terms")))) } }
                        .setNegativeButton("关闭",null).show()
                })
            }
            addView(chrome.text("公共库仅用于在线浏览，区域图源仅在覆盖地区显示；保留原版使用范围说明。",11))
            return@showPanel
        }
        listOf("天地图影像" to NativeMapController.SOURCE_IMAGERY, "天地图矢量" to NativeMapController.SOURCE_VECTOR,
            "天地图地形" to NativeMapController.SOURCE_TERRAIN).forEach { (name, id) ->
            addView(sourceRow(name,id) { selectSource(id) })
        }
        addView(chrome.text("图源坐标系  ·  WGS84", 12))
        addView(chrome.row("图源与地形署名") { AlertDialog.Builder(this@MainActivity).setTitle("数据来源").setMessage("影像、矢量及注记：天地图。\n本验证阶段地形来源以地图状态提示为准；现有 FABDEM 与修补数据的接入尚未验收。").setPositiveButton("关闭", null).show() })
    }

    private fun qualityPanel():Unit = chrome.showPanel("quality", "地图清晰度") {
        for ((label, quality) in listOf("标准" to NativeMapQuality.STANDARD, "高清" to NativeMapQuality.HIGH)) {
            addView(chrome.row((if (map.currentQuality() == quality) "✓ " else "") + label) {
                map.setQuality(quality)
                preferences.edit().putString("quality", if (quality == NativeMapQuality.HIGH) "high" else "standard").apply()
                chrome.closePanel()
            })
        }
        addView(chrome.text("高清使用更细瓦片，视角与缩放位置保持不变", 12))
        addView(chrome.row("固定影像级别：${preferences.getInt("raster-z",-1).takeIf{it>=0} ?: "自动"}") {
            val choices=arrayOf("自动")+(0..24).map{"z$it"}
            AlertDialog.Builder(this@MainActivity).setTitle("固定影像瓦片级别")
                .setSingleChoiceItems(choices,preferences.getInt("raster-z",-1)+1){d,i->
                    preferences.edit().putInt("raster-z",i-1).apply();applyRasterPreferences(map);secondaryMap?.let(::applyRasterPreferences);d.dismiss();qualityPanel()
                }.setNegativeButton("取消",null).show()
        })
        addView(chrome.text("道路与注记透明度",12))
        addView(android.widget.SeekBar(this@MainActivity).apply {
            max=100;progress=preferences.getInt("label-opacity",100)
            setOnSeekBarChangeListener(object:android.widget.SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(v:android.widget.SeekBar?,p:Int,user:Boolean){if(user){preferences.edit().putInt("label-opacity",p).apply();applyRasterPreferences(map);secondaryMap?.let(::applyRasterPreferences)}}
                override fun onStartTrackingTouch(v:android.widget.SeekBar?){}
                override fun onStopTrackingTouch(v:android.widget.SeekBar?){}
            })
        })
    }
    private fun applyRasterPreferences(target:NativeMapController){
        target.setFixedRasterZoom(preferences.getInt("raster-z",-1).takeIf{it in 0..24})
        target.setRasterLabelOpacity(preferences.getInt("label-opacity",100).coerceIn(0,100)/100.0)
    }

    private fun layers(): Unit = chrome.showPanel("layers", "图层", topAligned = true) {
        addView(chrome.row("地质图与图例") {openGeology()})
        addView(chrome.row("地图图源") { sources() })
        addView(chrome.row(if (terrain) "关闭三维地形" else "开启三维地形") { perform("terrain"); layers() })
        addView(chrome.row(if(contours) "✓ 等高线" else "等高线") { contours=!contours;saveTerrainLayers();layers() })
        addView(chrome.row(if(elevationColors) "✓ 海拔着色" else "海拔着色") { elevationColors=!elevationColors;saveTerrainLayers();layers() })
        addView(chrome.row("等高距与色带：${contourInterval}米") {
            val steps=listOf(30,50,100,200)
            AlertDialog.Builder(this@MainActivity).setTitle("等高距与海拔色带")
                .setSingleChoiceItems(steps.map { "${it}米" }.toTypedArray(),steps.indexOf(contourInterval)) { dialog,index ->
                    contourInterval=steps[index];saveTerrainLayers();dialog.dismiss();layers()
                }.setNegativeButton("取消",null).show()
        })
        map.terrainOverlayAttribution()?.let { addView(chrome.text(it,10)) }
    }
    private fun configureGeology(target:NativeMapController,primary:Boolean=false){
        target.configureGeology(com.shantu.nativeapp.geology.NativeGeologyCredentialProvider{geologyCredentials}){state->
            if(primary){geologyState=state;geologyPanel?.render(state)}
        }
        applyGeology(target)
    }
    private fun applyGeology(target:NativeMapController){target.setGeology(preferences.getBoolean("geology",false),if(preferences.getString("geology-source","world")=="geocloud20w")com.shantu.nativeapp.geology.NativeGeologySource.GEO_CLOUD_200K else com.shantu.nativeapp.geology.NativeGeologySource.WORLD,preferences.getFloat("geology-opacity",.85f).toDouble())}
    private fun openGeology():Unit=chrome.showPanel("geology","地质图",topAligned=true){
        addView(chrome.row(if(preferences.getBoolean("geology",false))"✓ 显示地质图" else "显示地质图"){
            preferences.edit().putBoolean("geology",!preferences.getBoolean("geology",false)).apply();applyGeology(map);secondaryMap?.let(::applyGeology);openGeology()
        })
        geologyPanel=com.shantu.nativeapp.ui.NativeGeologyPanel(chrome,onSource={source->preferences.edit().putString("geology-source",if(source==com.shantu.nativeapp.geology.NativeGeologySource.WORLD)"world" else "geocloud20w").putBoolean("geology",true).apply();applyGeology(map);secondaryMap?.let(::applyGeology)},onRetry={map.retryGeology();secondaryMap?.retryGeology()},onOpacity={v->preferences.edit().putFloat("geology-opacity",v.toFloat()).apply();applyGeology(map);secondaryMap?.let(::applyGeology)},onSelect={map.selectGeology(it)}).also{it.render(geologyState);addView(it)}
    }
    private fun saveTerrainLayers() {
        preferences.edit().putBoolean("contours",contours).putBoolean("elevation-colors",elevationColors).putInt("contour-interval",contourInterval).apply()
        map.setTerrainOverlay(contours,elevationColors,contourInterval)
    }
    private fun direction(target: NativeMapController = map) = chrome.showPanel("direction", "方向与视角") {
        addView(com.shantu.nativeapp.ui.NativeDirectionPanel(chrome,directionMode){mode->
            directionMode=mode;preferences.edit().putString("direction-mode",mode.name).apply();updateSensors();updatePosition()
        })
        addView(chrome.row("正北朝上") { freeCameraDirection();target.resetNorth() })
        addView(chrome.row("俯视") { target.setPitch(0.0) })
        addView(chrome.row("倾斜视角") { target.setPitch(50.0) })
        addView(chrome.row("左转 15°") { freeCameraDirection();target.setHeading(target.cameraSnapshot().headingDegrees - 15) })
        addView(chrome.row("右转 15°") { freeCameraDirection();target.setHeading(target.cameraSnapshot().headingDegrees + 15) })
    }
    private fun coordinateSearch() {
        chrome.showPanel("search", "搜索地点", topAligned = true) {
            val input = chrome.input("地点名称或经度,纬度").apply { setText(searchQuery) }
            addView(input)
            val results = LinearLayout(this@MainActivity).apply { orientation = LinearLayout.VERTICAL }
            fun search() {
                val query = input.text.toString().trim().take(120)
                if (query.isEmpty()) { toast("请输入地点名称或坐标"); return }
                searchQuery = query
                val coordinate = NativePlaceSearch.coordinate(query)
                if (coordinate != null) {
                    showPlace(NativePlace(query, coordinate.first, coordinate.second))
                    return
                }
                searchTask?.cancel(true)
                searchCancellation?.cancel()
                val cancellation = android.os.CancellationSignal().also { searchCancellation = it }
                val generation = ++searchGeneration
                results.removeAllViews()
                results.addView(chrome.text("正在搜索…", 12))
                searchTask = searchExecutor.submit {
                    val response = runCatching {
                        val local=offlineRoutes.searchPlaces(query)
                        if(preferences.getString("routing-preference","online")=="offlineOnly")local
                        else runCatching{placeSearch.search(query,cancellation)}.fold({(local+it).distinctBy{p->p.name to (p.longitude to p.latitude)}},{if(local.isNotEmpty())local else throw it})
                    }
                    handler.post {
                        if (destroyed || generation != searchGeneration || chrome.currentPanel() != "search") return@post
                        results.removeAllViews()
                        response.fold(onSuccess = { places ->
                            if (places.isEmpty()) results.addView(chrome.text("没有找到匹配地点，请补充地区或地址", 12))
                            places.forEach { place ->
                                results.addView(chrome.row(place.name) { showPlace(place) })
                                if (place.detail.isNotEmpty()) results.addView(chrome.text(place.detail, 11))
                            }
                            val history = runCatching { JSONArray(preferences.getString("search-history", "[]")) }.getOrDefault(JSONArray())
                            val next = JSONArray().put(query)
                            for (i in 0 until history.length()) if (history.optString(i) != query && next.length() < 20) next.put(history.optString(i))
                            preferences.edit().putString("search-history", next.toString()).apply()
                        }, onFailure = {
                            results.addView(chrome.text(if (it is IllegalArgumentException) it.message ?: "搜索失败" else "搜索网络连接失败，请重试", 12))
                            results.addView(chrome.row("重试") { search() })
                        })
                    }
                }
            }
            addView(chrome.row("搜索") { search() })
            input.imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH
            input.setOnEditorActionListener { _, action, _ ->
                if (action == android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH) { search(); true } else false
            }
            addView(results)
            val history = runCatching { JSONArray(preferences.getString("search-history", "[]")) }.getOrDefault(JSONArray())
            for (i in 0 until history.length()) {
                val query = history.optString(i)
                results.addView(chrome.row(query) { input.setText(query); search() })
            }
        }
    }

    private fun showPlace(place: NativePlace) {
        placeSelection?.let { selection -> placeSelection = null; selection(place); return }
        map.centerTo(place.latitude, place.longitude)
        chrome.showPanel("place", place.name, topAligned = true) {
            if (place.detail.isNotEmpty()) addView(chrome.text(place.detail, 12))
            addView(chrome.text("${place.longitude}, ${place.latitude}", 12))
            addView(chrome.row("保存为标记") { markerPanel(place) })
            addView(chrome.row("设为路线起点") { routePanel.setStart(place) })
            addView(chrome.row("到这里去") { routePanel.setEnd(place) })
            addView(chrome.row("返回搜索结果") { coordinateSearch() })
        }
    }

    private fun markerPanel(place: NativePlace? = null, kind: String = "pin", draftName: String? = null): Unit = chrome.showPanel("marker", "添加标记") {
        val name = chrome.input("标记名称").apply { setText(draftName ?: place?.name?.take(60).orEmpty()); textSize=13f }; addView(name)
        val types=listOf("pin" to "地点","box" to "长方体","sphere" to "球体","cylinder" to "圆柱","prism" to "轮廓模型","borehole" to "钻孔")
        addView(chrome.row("类型：${types.first { it.first==kind }.second}") {
            AlertDialog.Builder(this@MainActivity).setTitle("标记类型").setItems(types.map { it.second }.toTypedArray()) { _,index -> markerPanel(place,types[index].first,name.text.toString()) }.show()
        })
        addView(chrome.text(if (place == null) "位置取当前地图中心" else "位置取所选搜索结果", 12))
        addView(chrome.row("保存标记") {
            val title = name.text.toString().trim()
            if (title.isEmpty() || title.length > 60) { toast("名称需要 1–60 个字符"); return@row }
            val center = map.cameraSnapshot()
            val marker = JSONObject().put("id", UUID.randomUUID().toString()).put("kind", kind).put("name", title).put("note", "")
                .put("color", "#d0f76b").put("coordinates", JSONArray().put(place?.longitude ?: center.longitude).put(place?.latitude ?: center.latitude))
                .put("groundElevation", map.getElevation(place?.latitude ?: center.latitude,place?.longitude ?: center.longitude) ?: JSONObject.NULL).put("placement", "surface").put("offset", 0).put("width", 10)
                .put("length", 10).put("height", 10).put("heading", 0).put("pitch", 0).put("roll", 0).put("opacity", .85).put("visible", true)
            if(kind=="prism") marker.put("footprint",JSONArray(listOf(listOf(-.5,-.5),listOf(.5,-.5),listOf(.5,.5),listOf(-.5,.5))))
            if(kind=="borehole")marker.put("depth",10.0)
            fun save(value: JSONObject) {
                runCatching { store.upsert("annotations", value) }.onSuccess {
                    chrome.closePanel(); runCatching { renderWorkspace() }.onFailure { toast("已保存，地图显示刷新失败") }
                }.onFailure { toast("标记未保存，原有数据保留。") }
            }
            if(kind=="pin") save(marker)
            else NativeObjectEditor(this@MainActivity,chrome).showMarker(marker,::save) { chrome.closePanel() }
        })
    }

    private fun drawingPanel() {
        val core=store.load().getJSONObject("core")
        val targets=mutableListOf<com.shantu.nativeapp.navigation.NativeCoordinate>()
        fun append(points:JSONArray) {for(i in 0 until points.length()) {
            val p=points.optJSONArray(i) ?: continue
            targets.add(com.shantu.nativeapp.navigation.NativeCoordinate(p.getDouble(0),p.getDouble(1)))
        }}
        val tracks=core.getJSONArray("tracks")
        for(i in 0 until tracks.length()) {val t=tracks.getJSONObject(i);if(t.optBoolean("hidden"))continue
            val segments=t.getJSONArray("segments");for(j in 0 until segments.length())append(segments.getJSONArray(j))}
        val favorites=core.getJSONArray("favorites")
        for(i in 0 until favorites.length()){val f=favorites.getJSONObject(i);if(f.optBoolean("visible",true))append(f.getJSONObject("route").getJSONArray("coordinates"))}
        nativeDrawing.setSnapTargets(targets)
        if(drawingPreview==null)nativeDrawing.startNew() else nativeDrawing.show()
    }
    private fun renderDrawingPreview() {
        val targets=listOfNotNull(if(::map.isInitialized)map else null,secondaryMap?.takeIf {comparisonActive})
        drawingIds.forEach { id ->targets.forEach {it.removeRoute(id)}};drawingIds.clear()
        val track=drawingPreview ?: return
        val style=track.optJSONObject("style");val color=runCatching {Color.parseColor(style?.optString("color","#d0f76b") ?: "#d0f76b")}.getOrDefault(ShantuColors.accent)
        val opacity=style?.optDouble("opacity",1.0)?.coerceIn(.1,1.0) ?: 1.0
        val width=style?.optDouble("width",1.5)?.toFloat() ?: 1.5f
        val segments=track.optJSONArray("segments") ?: return
        for(i in 0 until segments.length()) {
            val points=segments.getJSONArray(i);if(points.length()<2)continue
            val id="native-draft:${track.getString("id")}:$i";drawingIds.add(id)
            val coords=(0 until points.length()).map {points.getJSONArray(it).let {p->p.getDouble(1) to p.getDouble(0)}}
            targets.forEach {it.replaceRoute(id,coords,(color and 0x00ffffff) or ((opacity*255).toInt() shl 24),width)}
        }
    }

    private fun recording(): Unit = chrome.showPanel("record", "记录") {
        addView(chrome.text(recordingSummary(RecordingFacade.snapshot(this@MainActivity)), 12).apply { tag = "record-summary" })
        addView(chrome.row("开始 / 继续") { val phase = RecordingFacade.snapshot(this@MainActivity).optString("phase"); requireLocation(if (phase == "paused") "resume" else "start") })
        addView(chrome.row("暂停") { recordCommand("pause") })
        addView(chrome.row("结束记录…") { finishRecordingDialog() })
        val actions=LinearLayout(this@MainActivity)
        actions.addView(chrome.row("全程") { recordingTrack()?.let { viewTrack(it) } },LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        actions.addView(chrome.row("位置标记") {
            val fix=lastLocation
            if(fix==null || System.currentTimeMillis()-fix.time !in 0..20000) {toast("等待设备有效定位后添加位置标记");return@row}
            markerPanel(NativePlace("记录标记",fix.longitude,fix.latitude))
        },LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        addView(actions)
        val photos=LinearLayout(this@MainActivity)
        photos.addView(chrome.row("拍摄照片") {takePhoto()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        photos.addView(chrome.row("导入照片") {pickPhoto()},LinearLayout.LayoutParams(0,chrome.dp(28),1f))
        addView(photos)
        addView(chrome.row("导出当前记录 GPX") {recordingTrack()?.let {track ->
            val workspace=JSONObject().put("core",JSONObject().put("tracks",JSONArray().put(track)))
            runCatching {NativeRouteFormats.exportFile(NativeRouteFormats.Format.GPX,workspace)}
                .onSuccess {prepareDocumentExport(it,"山兔当前记录.gpx","application/gpx+xml")}
                .onFailure {toast("记录导出失败，原记录保留")}
        }})
        addView(chrome.row("记录模式与采样设置") { NativeSamplingPanel(this@MainActivity,chrome,::recording).show() })
        addView(chrome.row("精度要求：${RecordingFacade.accuracy(this@MainActivity)} 米") {
            val choices = arrayOf("5 米", "10 米", "20 米", "40 米", "80 米")
            AlertDialog.Builder(this@MainActivity).setTitle("记录精度要求").setItems(choices) { _, which ->
                if (!RecordingFacade.saveAccuracy(this@MainActivity, intArrayOf(5, 10, 20, 40, 80)[which])) toast("设置未保存")
                recording()
            }.show()
        })
    }
    private fun recordingSummary(state: JSONObject): String {
        val segments = state.optJSONArray("segments") ?: JSONArray()
        var points = 0; for (i in 0 until segments.length()) points += segments.getJSONArray(i).length()
        val phase = when (state.optString("phase")) { "recording" -> "正在记录"; "paused" -> "已暂停"; "finished" -> "待保存"; else -> "未开始" }
        return "$phase · $points 点\n${state.optString("error")}".trim()
    }
    private fun recordCommand(action: String) = runCatching { RecordingFacade.command(this, action) }.onFailure { toast("记录操作未完成，请检查定位权限和当前状态。") }
    private fun recordingTrack():JSONObject? = runCatching {
        // A snapshot copy permits export/view without changing the live recording phase.
        RecordedTrackConversion.toManualTrack(JSONObject(RecordingFacade.snapshot(this).toString()).put("phase","finished"))
    }.onFailure {toast(it.message ?: "尚无记录点")}.getOrNull()
    private fun finishRecordingDialog() {
        val phase=RecordingFacade.snapshot(this).optString("phase")
        if(phase !in listOf("recording","paused","finished")) {toast("尚未开始记录");return}
        AlertDialog.Builder(this).setTitle("结束记录")
            .setMessage("保存本次轨迹，或取消轨迹并结束。已保存的照片和标记会保留。")
            .setPositiveButton("结束并保存") {_,_->
                if(phase=="finished" || recordCommand("finish").isSuccess)saveRecording()
            }.setNeutralButton("取消并结束") {_,_->
                AlertDialog.Builder(this).setTitle("丢弃本次轨迹？").setMessage("这会清除尚未保存的记录点，照片和标记保留。")
                    .setNegativeButton("返回记录",null).setPositiveButton("丢弃并结束") {_,_->
                        if(phase=="finished" || recordCommand("finish").isSuccess) {
                            if(recordCommand("clear").isSuccess){chrome.closePanel();renderWorkspace()}
                        }
                    }.show()
            }.setNegativeButton("返回记录",null).show()
    }
    private fun saveRecording() {
        val saved = runCatching {
            val track = RecordedTrackConversion.toManualTrack(RecordingFacade.snapshot(this))
            store.upsert("tracks", track)
            RecordingFacade.command(this, "clear")
        }
        if (saved.isFailure) { toast("保存未完成，原始记录已保留。"); return }
        chrome.closePanel()
        runCatching { renderWorkspace() }
            .onSuccess { toast("记录已保存") }
            .onFailure { toast("记录已保存，地图显示未能刷新。") }
    }

    private fun collections() = collectionPanel.show()
    private fun refreshPhotos() {
        if(!::photoPanel.isInitialized) return
        val workspace=store.load(); val core=workspace.getJSONObject("core")
        val tracks=core.optJSONArray("tracks") ?: JSONArray()
        photoPanel.setTracks((0 until tracks.length()).mapNotNull { runCatching { NativePhotoMatching.fromTrackJson(tracks.getJSONObject(it)) }.getOrNull() })
        val annotations=core.optJSONArray("annotations") ?: JSONArray()
        photoPanel.setAnnotations((0 until annotations.length()).map { annotations.getJSONObject(it) })
        val photos=workspace.optJSONArray("photos") ?: JSONArray()
        photoPanel.setPhotos((0 until photos.length()).map { photos.getJSONObject(it) })
    }
    private fun savePhoto(photo: JSONObject,completed:(Boolean)->Unit) {
        filesExecutor.execute {
            val result=runCatching { store.upsert("photos",photo) }
            handler.post {if(!destroyed) {
                completed(result.isSuccess)
                if(result.isSuccess)runCatching {refreshPhotos();renderWorkspace()}.onFailure {toast("照片已保存，地图刷新失败")}
                else toast("照片未保存，编辑内容保留")
            }}
        }
    }
    private fun shareSelection(refs: List<CollectionRecordRef>) {
        if(refs.isEmpty()) return
        filesExecutor.execute {
            val result=runCatching {
                val workspace=store.load(); val sourceCore=workspace.getJSONObject("core")
                val core=JSONObject().put("format","guanyun-backup").put("version",1)
                val selected=JSONObject().put("format","shantu-workspace").put("version",2).put("core",core)
                    .put("settings",JSONObject()).put("mapSources",JSONArray()).put("cadDocuments",JSONArray())
                    .put("industryProjects",JSONArray()).put("limitations",JSONArray())
                listOf("tracks","favorites","annotations","areas","measurements","sections").forEach { container ->
                    val ids=refs.filter { it.container==container }.map { it.id }.toSet()
                    val original=sourceCore.optJSONArray(container) ?: JSONArray()
                    core.put(container,JSONArray((0 until original.length()).map { original.getJSONObject(it) }.filter { it.optString("id") in ids }))
                }
                val trackIds=refs.filter { it.container=="tracks" }.map { it.id }.toSet()
                val markerIds=refs.filter { it.container=="annotations" }.map { it.id }.toSet()
                val photos=workspace.optJSONArray("photos") ?: JSONArray()
                selected.put("photos",JSONArray((0 until photos.length()).map { photos.getJSONObject(it) }.filter {
                    it.optString("trackId") in trackIds || it.optString("annotationId") in markerIds
                }))
                // Native selection format retains full object fields and associated photos.
                // It deliberately excludes unrelated private sources and global settings.
                WorkspaceStore.validateWorkspace(selected)
                selected.toString().toByteArray(Charsets.UTF_8)
            }
            handler.post { if(!destroyed) result.onSuccess { shareBytes(it,"山兔收藏.json","application/json") }.onFailure { toast("所选对象分享文件生成失败，原数据保留") } }
        }
    }
    private fun trackSegments(item:JSONObject):List<List<Pair<Double,Double>>> {
        val arrays=item.optJSONArray("segments") ?: JSONArray().apply {item.optJSONObject("route")?.optJSONArray("coordinates")?.let {put(it)}}
        return (0 until arrays.length()).mapNotNull {i ->arrays.optJSONArray(i)?.let {line ->
            (0 until line.length()).map {j->line.getJSONArray(j).let {it.getDouble(0) to it.getDouble(1)}}.takeIf {it.isNotEmpty()}
        }}
    }
    private fun cacheSelection(refs:List<CollectionRecordRef>) {
        val core=store.load().getJSONObject("core")
        val chosen=refs.filter {it.container in listOf("tracks","favorites")}.mapNotNull {ref->
            val items=core.optJSONArray(ref.container) ?: JSONArray()
            (0 until items.length()).map {items.getJSONObject(it)}.firstOrNull {it.optString("id")==ref.id}
        }
        val segments=chosen.flatMap(::trackSegments)
        if(segments.isEmpty()){toast("请选择有坐标的路线或轨迹");return}
        cachePanel.createSegments(segments,chosen.joinToString("、") {it.optString("name","路线")})
    }
    private fun plannedTrack(route:com.shantu.nativeapp.navigation.NativePlannedRoute)=JSONObject()
        .put("id",UUID.randomUUID().toString()).put("name",route.stops.joinToString(" → ") {it.name}.ifBlank {"规划路线"})
        .put("createdAt",route.createdAt).put("source","manual")
        .put("segments",JSONArray().put(route.toJson().getJSONArray("coordinates")))
        .put("style",JSONObject().put("color","#d0f76b").put("width",1.5).put("opacity",1))
    private fun viewTrack(track:JSONObject) {
        val coordinates=trackSegments(track).flatten().map {com.shantu.nativeapp.navigation.NativeCoordinate(it.first,it.second)}
        if(coordinates.isEmpty()){toast("没有可查看的坐标");return}
        map.restoreCamera(com.shantu.nativeapp.navigation.NativeRouteViewport.fit(coordinates,map.cameraSnapshot(),mapRoot.width,mapRoot.height))
        chrome.closePanel()
    }
    private fun navigateTrack(track:JSONObject) {
        val segments=trackSegments(track).filter {it.size>=2}
        fun begin(points:List<Pair<Double,Double>>) {
            val mode=when(track.optJSONObject("style")?.optString("travelMode")){"car","motorcycle"->"auto";"bicycle"->"bicycle";else->"pedestrian"}
            startNavigation(JSONObject().put("mode",mode).put("coordinates",JSONArray(points.map {JSONArray(listOf(it.first,it.second))}))
                .put("snapped",JSONArray()).put("stops",JSONArray()).put("steps",JSONArray()),track.optString("name","轨迹导航"))
        }
        if(segments.isEmpty()){toast("轨迹至少需要两个点");return}
        if(segments.size==1)begin(segments.first())
        else AlertDialog.Builder(this).setTitle("选择导航分段 · 不连接断点")
            .setItems(Array(segments.size){"第 ${it+1} 段 · ${segments[it].size} 点"}) {_,index->begin(segments[index])}.show()
    }
    private fun shareBytes(bytes: ByteArray,name:String,mime:String) {
        runCatching {
            val dir=java.io.File(cacheDir,"shared-exports/${UUID.randomUUID()}").apply { mkdirs() }
            val file=java.io.File(dir,name.substringAfterLast('/').substringAfterLast('\\')).apply { writeBytes(bytes) }
            val uri=androidx.core.content.FileProvider.getUriForFile(this,"$packageName.files",file)
            val intent=Intent(Intent.ACTION_SEND).apply {
                type=mime;putExtra(Intent.EXTRA_STREAM,uri);addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                clipData=android.content.ClipData.newRawUri(name,uri)
            }
            startActivity(Intent.createChooser(intent,"分享给应用"))
        }.onFailure { toast("无法打开系统分享，文件仍保存在本机") }
    }
    private fun sharePhoto(photo:JSONObject) {
        filesExecutor.execute {
            val result=runCatching { com.shantu.nativeapp.photos.NativePhotoExport.jpeg(photo) }
            handler.post { if(!destroyed) result.onSuccess { shareBytes(it,"山兔照片.jpg","image/jpeg") }.onFailure { toast("照片数据无法读取") } }
        }
    }
    private fun cameraFile(): java.io.File? = pendingCameraFile?.takeIf { it.matches(Regex("[0-9a-f-]{36}\\.jpg")) }
        ?.let { java.io.File(filesDir,"camera-captures/$it") }
    private fun takePhoto() {
        if(checkSelfPermission(Manifest.permission.CAMERA)!=PackageManager.PERMISSION_GRANTED) {requestPermissions(arrayOf(Manifest.permission.CAMERA),203);return}
        pendingCameraFile="${UUID.randomUUID()}.jpg"
        val file=cameraFile() ?: return
        file.parentFile?.mkdirs()
        val uri=androidx.core.content.FileProvider.getUriForFile(this,"$packageName.files",file)
        runCatching { startActivityForResult(Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(android.provider.MediaStore.EXTRA_OUTPUT,uri)
            clipData=android.content.ClipData.newRawUri("拍照",uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        },107) }.onFailure { pendingCameraFile=null; toast("此设备没有可用相机应用") }
    }
    private fun pickPhoto() = startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type="image/*";addCategory(Intent.CATEGORY_OPENABLE);putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true) },106)
    private fun importPhoto(uri: android.net.Uri) {
        filesExecutor.execute {
            val result=runCatching {
                val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { if(it.moveToFirst()) it.getString(0) else null } ?: "照片"
                val bytes=contentResolver.openInputStream(uri)?.use { NativePhotoImporter.readBounded(it) } ?: error("无法读取图片")
                NativePhotoImporter.decode(name,bytes)
            }
            handler.post { if(!destroyed) result.onSuccess { refreshPhotos(); photoPanel.show(); photoPanel.acceptDraft(it) }.onFailure {
                AlertDialog.Builder(this).setTitle("照片未导入").setMessage("图片无法解码、超过大小限制，或元数据不受支持；原文件保留。请选择另一张照片。").setPositiveButton("关闭",null).show()
            } }
        }
    }
    private fun cacheSources(): List<NativeCacheSource> = listOf(
        NativeCacheSource(NativeMapController.SOURCE_IMAGERY,"天地图影像",null,tiandituKey),
        NativeCacheSource(NativeMapController.SOURCE_VECTOR,"天地图矢量",null,tiandituKey),
        NativeCacheSource(NativeMapController.SOURCE_TERRAIN,"天地图地形",null,tiandituKey),
    ) + sourceCatalog.sources.map { NativeCacheSource(it.id,it.name,it) }
    private fun toolsPanel() = chrome.showPanel("tools", "工具", width = 232) {
        addView(chrome.row("离线路网管理") {openOfflineRouting()})
        addView(chrome.row("本地离线地图 / 旧缓存迁入") {openOfflineMaps()})
        addView(chrome.row("迁移旧版未保存画线 / 暂停记录") {openTaskMigration()})
        addView(chrome.row("工程坐标转换") {com.shantu.nativeapp.ui.NativeCoordinatePanel(this@MainActivity,chrome).show()})
        addView(chrome.row("返航与车位 / 营地") {openReturnHome()})
        addView(chrome.row("个性化外观") {appearancePanel()})
        addView(chrome.row("控件布局编辑 / 导入导出") {openLayoutEditor()})
        addView(chrome.row("扫描路线 / 图源二维码") {startActivityForResult(Intent(this@MainActivity,com.shantu.nativeapp.ui.NativeQrActivity::class.java),110)})
        addView(chrome.row("双图对比") { openComparison() })
        addView(chrome.row("三维剖面") {openSections()})
        addView(chrome.row("勘探测线 / 测站投影") {openSurveySection()})
        addView(chrome.row("行业图纸：剖面 / 钻孔") {refreshIndustry();industryPanel.show()})
        addView(chrome.row("CAD 工程图") { refreshCad();cadPanel.show() })
        addView(chrome.row("离线地图缓存") { cachePanel.show() })
        addView(chrome.row("照片与轨迹相册") { refreshPhotos(); photoPanel.show() })
        addView(chrome.row("从文件夹批量导入照片") {startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply{addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)},116)})
        addView(chrome.row("导入完整工程") { importFile() }); addView(chrome.row("导出完整工程") { exportFile() })
        addView(chrome.row("导入路线 / 地点文件") { importRouteFile() })
        addView(chrome.row("导出 GPX") { exportRouteFile(NativeRouteFormats.Format.GPX) })
        addView(chrome.row("导出 GeoJSON") { exportRouteFile(NativeRouteFormats.Format.GEOJSON) })
        addView(chrome.row("导出 KML") { exportRouteFile(NativeRouteFormats.Format.KML) })
        addView(chrome.row("连线测量") { drawing = false; geometryPanel.open("measurements") })
        addView(chrome.row("划区域") { drawing = false; geometryPanel.open("areas") })
    }
    private fun mapBounds():List<Double>? {
        val points=listOf(0f to 0f,map.view.width.toFloat() to 0f,0f to map.view.height.toFloat(),map.view.width.toFloat() to map.view.height.toFloat())
            .mapNotNull{map.screenToCoordinate(it.first,it.second)}
        if(points.size!=4)return null
        val west=points.minOf{it.second};val east=points.maxOf{it.second};val south=points.minOf{it.first};val north=points.maxOf{it.first}
        return listOf(west,south,east,north).takeIf{east-west<180&&west<east&&south<north}
    }
    private fun openOfflineRouting(){
        chrome.closePanel()
        offlineRoutingPanel=com.shantu.nativeapp.ui.NativeOfflineRoutingPanel(this,offlineRouting,bounds=::mapBounds,
            routingPreference={preferences.getString("routing-preference","online")?:"online"},
            onRoutingPreference={preferences.edit().putString("routing-preference",it).apply()},
            onImport={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="application/json";addCategory(Intent.CATEGORY_OPENABLE)},113)},
            onExport={name,bytes->prepareDocumentExport(bytes,name,"application/json")},
            onShow=::showBounds,chrome=chrome)
    }
    private fun openOfflineMaps(){
        offlineMapsPanel?.dispose()
        offlineMapsPanel=com.shantu.nativeapp.ui.NativeOfflineMapsPanel(this,offlineMapStore,legacyArchive,
            onRequestMapImport={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="*/*";addCategory(Intent.CATEGORY_OPENABLE)},114)},
            onRequestLegacyArchive={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="application/zip";addCategory(Intent.CATEGORY_OPENABLE)},115)},
            onSelect={source->reloadSourceCatalog();sourceCatalog.sources.find{it.id==source.id}?.let{map.setCustomSource(it);preferences.edit().putString("source",it.id).apply()};chrome.closePanel()},
            onShow=::showBounds,chrome=chrome,onRequestGeoreferencedImage={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="image/*";addCategory(Intent.CATEGORY_OPENABLE)},118)})
    }
    private fun openTaskMigration(){
        taskMigrationPanel?.dispose()
        taskMigrationPanel=com.shantu.nativeapp.ui.NativeTaskMigrationPanel(this,store,chrome,onRequestMigrationFile={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="application/json";addCategory(Intent.CATEGORY_OPENABLE)},120)},onDismiss={renderWorkspace()})
    }
    private fun imageGeoreferencing(){
        val uri=pendingGeorefImage?:return
        chrome.showPanel("georef","配准图片",topAligned=true){
            val world=chrome.input("世界文件6行：A D B E C F（首像素中心）").apply{setSingleLine(false);minLines=2;maxLines=6;setText(pendingWorldFile)}
            addView(world)
            addView(chrome.row("选择世界文件 .pgw / .jgw / .wld") {pendingWorldFile=world.text.toString();startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="*/*";addCategory(Intent.CATEGORY_OPENABLE)},119)})
            val crs=chrome.input("明确源CRS：EPSG、PROJ或WKT");addView(crs)
            addView(chrome.row("确认配准并导入"){
                val worldText=world.text.toString();val crsText=crs.text.toString()
                filesExecutor.execute{
                    val result=runCatching{
                        val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())it.getString(0)else null}?:"配准影像"
                        contentResolver.openInputStream(uri)?.use{offlineMapStore.importGeoreferencedImage(name,it,contentResolver.getType(uri)?:"image/png",worldText,crsText)}?:error("图片无法读取")
                    }
                    handler.post{if(!destroyed)result.onSuccess{pendingGeorefImage=null;pendingWorldFile="";reloadSourceCatalog();openOfflineMaps()}.onFailure{toast(it.message?:"配准图片未导入")}}
                }
            })
        }
    }
    private fun openReturnHome(){
        chrome.closePanel()
        fun lines(track:JSONObject)=trackSegments(track).map{segment->segment.map{com.shantu.nativeapp.navigation.NativeCoordinate(it.first,it.second)}}
        com.shantu.nativeapp.ui.NativeReturnHomePanel(this,offlineRoutes,
            currentGps={lastLocation?.takeIf{it.provider==LocationManager.GPS_PROVIDER&&it.accuracy<=30&&System.currentTimeMillis()-it.time in 0..10_000}?.let{NativePlace("当前位置",it.longitude,it.latitude)}},
            recordingSegments={recordingTrack()?.let(::lines)?:emptyList()},
            savedTrackSegments={val a=store.load().getJSONObject("core").getJSONArray("tracks");(0 until a.length()).map{a.getJSONObject(it).let{t->t.optString("name","轨迹") to lines(t)}}},
            savedMarkers={val a=store.load().getJSONObject("core").getJSONArray("annotations");(0 until a.length()).mapNotNull{a.getJSONObject(it).let{m->m.optJSONArray("coordinates")?.let{c->NativePlace(m.optString("name","标记"),c.optDouble(0),c.optDouble(1))}}}},
            onRemember={p,name,icon->markerPanel(NativePlace(name,p.longitude,p.latitude),"pin",name)},
            onNavigate={favorite->startNavigation(favorite.getJSONObject("route"),favorite.optString("name","返航"))},chrome=chrome)
    }
    private fun appearanceValue():JSONObject = runCatching {
        JSONObject(store.load().getJSONObject("settings").optString(com.shantu.nativeapp.appearance.NativeAppearanceTokens.THEME_KEY,"{}"))
    }.getOrDefault(JSONObject())
    private fun applySavedAppearance() {
        val dark=(resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK)==android.content.res.Configuration.UI_MODE_NIGHT_YES
        chrome.applyAppearance(com.shantu.nativeapp.appearance.NativeAppearanceTokens.tokens(appearanceValue(),dark))
    }
    private fun appearancePanel() {
        com.shantu.nativeapp.ui.NativeAppearancePanel(this,chrome,appearanceValue(),
            onPreview={_,tokens->chrome.applyAppearance(tokens)},
            onSave={value,tokens->store.updateSetting(com.shantu.nativeapp.appearance.NativeAppearanceTokens.THEME_KEY,value.toString());chrome.applyAppearance(tokens)}).show()
    }
    private fun openSections() {
        sectionPanel?.dispose();sectionSurface?.close()
        if (!terrain) { terrain=true; map.setTerrain(true); chrome.setTerrainButton(true) }
        val core=store.load().getJSONObject("core")
        var expectedSections=JSONArray(core.optJSONArray("sections")?.toString() ?: "[]")
        var expectedNotes=JSONArray(core.optJSONArray("sectionNotes")?.toString() ?: "[]")
        val annotations=core.optJSONArray("annotations") ?: JSONArray()
        val models=(0 until annotations.length()).map {JSONObject(annotations.getJSONObject(it).toString())}
        val c=map.cameraSnapshot()
        val initial=JSONObject().put("enabled",true).put("color","#9de8c4")
            .put("plane",JSONObject().put("center",JSONArray().put(c.longitude).put(c.latitude)).put("width",1000).put("height",1000).put("heading",0).put("tilt",0).put("roll",0))
        map.getElevation(c.latitude,c.longitude)?.takeIf {it.isFinite()}?.let {initial.put("altitude",it)}
        val surface=map.createSectionSurfaceLayer();sectionSurface=surface
        sectionPanel=com.shantu.nativeapp.ui.NativeSectionPanel(this,chrome,expectedSections,expectedNotes,initial,
            sample={settings->
                val sampler=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main) {map.createSectionDemSampler()}
                try {sampler.sample(com.shantu.nativeapp.section.NativeSectionSettings.parse(settings),models)}finally {sampler.close()}
            },onCommit={sections,notes->
                store.replaceSections(expectedSections,expectedNotes,sections,notes)
                expectedSections=JSONArray(sections.toString());expectedNotes=JSONArray(notes.toString())
            },onShowSurface={snapshot,notes->surface.show(snapshot,notes)},
            onExport={profile,notes->
                shareBytes(JSONObject().put("profile",profile).put("notes",notes).toString(2).toByteArray(),"山兔剖面与测点.json","application/json")
            },onClose={surface.clear();sectionPanel=null},onExportImage=::saveProfilePng)
        sectionPanel!!.open()
    }
    private fun showBounds(b:List<Double>){map.restoreCamera(com.shantu.nativeapp.navigation.NativeRouteViewport.fit(listOf(com.shantu.nativeapp.navigation.NativeCoordinate(b[0],b[1]),com.shantu.nativeapp.navigation.NativeCoordinate(b[2],b[3])),map.cameraSnapshot(),mapRoot.width,mapRoot.height));chrome.closePanel()}
    private fun openSurveySection(saved:JSONObject?=null){
        surveyPanel?.dispose()
        val id=saved?.optString("id")?:UUID.randomUUID().toString()
        val c=map.cameraSnapshot()
        val initial=saved?.optJSONObject("settings")?.let{JSONObject(it.toString())}?:JSONObject().put("enabled",true).put("objectId",id).put("color","#9de8c4")
            .put("plane",JSONObject().put("center",JSONArray().put(c.longitude).put(c.latitude)).put("width",1000).put("height",1000).put("heading",0).put("tilt",0).put("roll",0))
        if(!initial.has("altitude"))initial.put("altitude",map.getElevation(c.latitude,c.longitude)?:0.0) // inactive ordinary plane; survey DEM stays nullable until sampled
        surveyPanel=com.shantu.nativeapp.ui.NativeSurveySectionPanel(this,chrome,initial,
            sampleDem={line,cancel->
                val sampler=kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){map.createSectionDemSampler()}
                try{cancel.throwIfCanceled();sampler.sampleSurvey(com.shantu.nativeapp.section.NativeSurveyLine.parse(line))}finally{sampler.close()}
            },onCommit={settings->runCatching{store.upsert("sections",JSONObject().put("id",id).put("name",saved?.optString("name")?:"勘探测线").put("settings",settings.put("objectId",id)));renderWorkspace();true}.getOrDefault(false)},
            onExportImage=::saveProfilePng,
            onRequestMapPoint={_,enabled->surveyPicking=enabled;chrome.setTaskActive(enabled);if(enabled)chrome.closePanel()},
            onLocate={lon,lat->map.centerTo(lat,lon)},onClose={surveyPicking=false;chrome.setTaskActive(drawing)},onShowProjection={view->chrome.setRouteDisplayInfo(view)})
        surveyPanel!!.open()
    }
    private fun refreshIndustry() {
        if(!::industryPanel.isInitialized)return
        val projects=store.load().optJSONArray("industryProjects") ?: JSONArray()
        industryPanel.setProjects((0 until projects.length()).map {projects.getJSONObject(it)})
    }
    private fun importIndustry(uri:android.net.Uri) {
        val kind=industryKind
        filesExecutor.execute {
            val result=runCatching {
                val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use {if(it.moveToFirst())it.getString(0)else null} ?: "行业工作簿.xlsx"
                val bytes=contentResolver.openInputStream(uri)!!.use {input->
                    val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                    while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=20*1024*1024);out.write(buffer,0,n)};out.toByteArray()
                };name to bytes
            }
            result.onSuccess {(name,bytes)->loadIndustry(kind,name,bytes)}.onFailure {handler.post {if(!destroyed)industryPanel.acceptFailure(kind,"工作簿","文件无法读取或超过20MB")}}
        }
    }
    private fun loadIndustry(kind:String,name:String,bytes:ByteArray,project:JSONObject?=null) {
        filesExecutor.execute {
            val result=runCatching {
                val workbook=com.shantu.nativeapp.industry.NativeXlsxReader.read(bytes.inputStream(),name)
                val imported=if(kind=="section")com.shantu.nativeapp.industry.NativeSectionImporter.importWorkbook(workbook)else com.shantu.nativeapp.industry.NativeDrillImporter.importWorkbook(workbook)
                com.shantu.nativeapp.industry.NativeIndustryRenderer.render(kind,imported.normalized)
            }
            handler.post {if(!destroyed)result.onSuccess {rendered->
                if(project==null)industryPanel.acceptDraft(kind,name,bytes,rendered)else industryPanel.acceptOpened(project,rendered)
            }.onFailure {error->
                industryPanel.acceptFailure(kind,name,error.message?.take(300) ?: "无法解析工作簿",(error as? com.shantu.nativeapp.industry.NativeIndustryImportException)?.issues ?: JSONArray())
            }}
        }
    }

    private fun refreshCad() {
        if(!::cadPanel.isInitialized)return
        val items=store.load().getJSONArray("cadDocuments")
        cadPanel.setDocuments((0 until items.length()).map { items.getJSONObject(it) })
    }
    private fun saveCad(doc:JSONObject):Boolean {
        val saved=runCatching { store.upsert("cadDocuments",doc) }.isSuccess
        if(saved) runCatching { refreshCad();renderWorkspace() }.onFailure { toast("工程图已保存，地图刷新未完成") }
        else toast("工程图未保存，原数据保留")
        return saved
    }
    private fun importCad(uri:android.net.Uri) {
        filesExecutor.execute {
            val result=runCatching {
                val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use { if(it.moveToFirst())it.getString(0) else null } ?: "工程图.dxf"
                val bytes=contentResolver.openInputStream(uri)?.use { NativeDxfImporter.readBounded(it) } ?: error("无法读取工程图")
                if(name.endsWith(".dwg",true))com.shantu.nativeapp.cad.NativeDwgDecoder.decode(name,bytes,cacheDir.resolve("cad-decode")) else NativeDxfImporter.decode(name,bytes)
            }
            handler.post { if(!destroyed) result.onSuccess { refreshCad();cadPanel.show();cadPanel.acceptDraft(it) }.onFailure {
                AlertDialog.Builder(this).setTitle("CAD未导入").setMessage(it.message?.take(300) ?: "文件解析失败，原文件保留")
                    .setPositiveButton("关闭",null).show()
            } }
        }
    }
    private fun renderWorkspace() {
        objectRefs.clear()
        renderWorkspaceOn(map)
        secondaryMap?.takeIf { comparisonActive }?.let(::renderWorkspaceOn)
        renderDrawingPreview()
    }
    private fun renderWorkspaceOn(map:NativeMapController) {
        map.replacePhotos(store.load().optJSONArray("photos")?:JSONArray())
        map.clearUserObjects()
        val workspace=store.load()
        val core = workspace.getJSONObject("core")
        collectionPreview.forEach{(ref,value)->val records=core.optJSONArray(ref.container);if(records!=null)for(i in 0 until records.length())if(records.optJSONObject(i)?.optString("id")==ref.id)records.put(i,JSONObject(value.toString()))}
        val markers = core.optJSONArray("annotations") ?: JSONArray()
        for (i in 0 until markers.length()) {
            val marker=markers.getJSONObject(i);objectRefs[marker.getString("id")]=CollectionRecordRef("annotations",marker.getString("id"));map.renderMarker(marker)
        }
        val tracks = core.optJSONArray("tracks") ?: JSONArray()
        for (i in 0 until tracks.length()) { val track = tracks.getJSONObject(i); if (track.optBoolean("hidden")) continue
            renderTrackSegments(map,track,CollectionRecordRef("tracks",track.getString("id")))
            val segments = track.getJSONArray("segments")
            for (j in 0 until segments.length()) { val seg = segments.getJSONArray(j); if (seg.length() < 2) continue
                val coords = (0 until seg.length()).map { n -> seg.getJSONArray(n).let { it.getDouble(1) to it.getDouble(0) } }
                val style = track.optJSONObject("style")
                val color = runCatching { Color.parseColor(style?.optString("color", "#ffb477") ?: "#ffb477") }.getOrDefault(ShantuColors.accent)
                val opacity = style?.optDouble("opacity", 1.0)?.takeIf { it.isFinite() }?.coerceIn(.1, 1.0) ?: 1.0
                val width = style?.optDouble("width", 1.5)?.takeIf { it.isFinite() }?.coerceIn(.5, 5.0)?.toFloat() ?: 1.5f
                objectRefs["${track.getString("id")}:$j"]=CollectionRecordRef("tracks",track.getString("id"))
                // Geometry is rendered by the shared colored-fragment adapter above.
            }
        }
        val favorites = core.optJSONArray("favorites") ?: JSONArray()
        for (i in 0 until favorites.length()) {
            val favorite = favorites.getJSONObject(i)
            if (favorite.optBoolean("hidden", false) || !favorite.optBoolean("visible",true)) continue
            val route = favorite.getJSONObject("route")
            val points = route.getJSONArray("coordinates")
            val style = route.optJSONObject("style")
            val color = runCatching { Color.parseColor(style?.optString("color", "#d0f76b") ?: "#d0f76b") }.getOrDefault(ShantuColors.accent)
            val width = style?.optDouble("width", 1.5)?.toFloat() ?: 1.5f
            objectRefs["favorite:${favorite.getString("id")}"]=CollectionRecordRef("favorites",favorite.getString("id"))
            map.replaceRoute("favorite:${favorite.getString("id")}", (0 until points.length()).map { n -> points.getJSONArray(n).let { it.getDouble(1) to it.getDouble(0) } }, color, width)
        }
        val areas = core.optJSONArray("areas") ?: JSONArray()
        for (i in 0 until areas.length()) {
            val area = areas.getJSONObject(i); if (!area.optBoolean("visible", true)) continue
            val boundary = area.getJSONArray("boundary")
            val color = Color.parseColor(area.getString("color")) and 0x00ffffff or 0x55000000
            objectRefs["area:${area.getString("id")}"]=CollectionRecordRef("areas",area.getString("id"))
            map.replaceArea("area:${area.getString("id")}", (0 until boundary.length()).map { n -> boundary.getJSONArray(n).let { it.getDouble(1) to it.getDouble(0) } }, color)
        }
        val measurements = core.optJSONArray("measurements") ?: JSONArray()
        for (i in 0 until measurements.length()) {
            val measurement = measurements.getJSONObject(i); if (!measurement.optBoolean("visible", true)) continue
            val points = measurement.getJSONArray("points")
            objectRefs["measurement:${measurement.getString("id")}"]=CollectionRecordRef("measurements",measurement.getString("id"))
            map.replaceRoute("measurement:${measurement.getString("id")}", (0 until points.length()).map { n -> points.getJSONObject(n).getJSONArray("coordinates").let { it.getDouble(1) to it.getDouble(0) } }, ShantuColors.close, 2f)
        }
        renderCadDocuments(map,workspace.optJSONArray("cadDocuments") ?: JSONArray())

        if(map===this.map && ::navigationPanel.isInitialized) navigationPanel.refreshOverlays()
    }
    private fun renderTrackSegments(target:NativeMapController,track:JSONObject,ref:CollectionRecordRef){
        val settings=runCatching{JSONObject(preferences.getString("route-display","{}")!!)}.getOrDefault(JSONObject())
        val style=track.optJSONObject("style")?:JSONObject()
        val opacity=style.optDouble("opacity",1.0).coerceIn(.1,1.0)
        val width=style.optDouble("width",1.5).coerceIn(.5,5.0).toFloat()
        com.shantu.nativeapp.map.NativeRouteMapSegments.build(track,settings.optString("mode","original")).forEachIndexed{i,fragment->
            val id="display:${ref.container}:${ref.id}:$i";objectRefs[id]=ref
            target.replaceRoute(id,fragment.coordinates.map{it.latitude to it.longitude},(fragment.color and 0xffffff) or ((opacity*255).toInt() shl 24),width)
        }
    }
    private fun openLayoutEditor(){
        layoutEditor?.dispose()
        layoutEditor=com.shantu.nativeapp.ui.NativeLayoutEditor(this,chrome,chrome.currentLayoutDraft(),onSave={json->
            runCatching{store.updateSetting("shantu.ui-layout.v1",json.toString());preferences.edit().putString("layout",json.toString()).commit()}.getOrDefault(false)
        },onExportRequest={json->prepareDocumentExport(json.toString(2).toByteArray(),"shantu-layout-draft.json","application/json")},onImportRequest={startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply{type="application/json";addCategory(Intent.CATEGORY_OPENABLE)},117)},onUnknownSelectors={list->if(list.isNotEmpty())toast("${list.size}项旧网页控件暂无对应，参数已保留")}).also{it.show()}
    }
    private fun openRouteDisplay(track:JSONObject,ref:CollectionRecordRef){
        val settings=runCatching{JSONObject(preferences.getString("route-display",null)?:com.shantu.nativeapp.ui.NativeRouteDisplayPanel.defaults().toString())}.getOrDefault(com.shantu.nativeapp.ui.NativeRouteDisplayPanel.defaults())
        com.shantu.nativeapp.ui.NativeRouteDisplayPanel(this,chrome,onDisplay={renderWorkspace()},onClose={
            val arr=store.load().getJSONObject("core").getJSONArray(ref.container)
            val saved=(0 until arr.length()).map{arr.getJSONObject(it)}.firstOrNull{it.optString("id")==ref.id}
            if(saved==null)chrome.closePanel()else objectDetails(ref.container,saved)
        },settings=settings,onSettingsChanged={value->
            preferences.edit().putString("route-display",value.toString()).apply();store.updateSetting("shantu.route-display.v1",value.toString());renderWorkspace()
        }).show(track)
    }
    private fun renderCadDocuments(target:NativeMapController,documents:JSONArray) {
        for(i in 0 until documents.length()) {
            val doc=documents.getJSONObject(i);if(!doc.optBoolean("visible",true))continue
            val layers=doc.getJSONArray("layers")
            val hidden=(0 until layers.length()).map { layers.getJSONObject(it) }.filter { !it.optBoolean("visible",true) }.map { it.optString("name") }.toSet()
            val features=doc.getJSONArray("mapFeatures")
            for(j in 0 until features.length()) {
                val f=features.getJSONObject(j);if(f.optString("layer") in hidden)continue
                val id="cad:${doc.getString("id")}:${f.getString("id")}";val geometry=f.getJSONObject("geometry")
                val coords=geometry.getJSONArray("coordinates")
                val color=runCatching { Color.parseColor(f.optString("color","#ffda63")) }.getOrDefault(Color.rgb(255,218,99))
                fun line(arr:JSONArray,suffix:String="") {
                    target.replaceRoute(id+suffix,(0 until arr.length()).map { arr.getJSONArray(it).let { p->p.getDouble(1) to p.getDouble(0) } },color,1.5f)
                }
                when(geometry.getString("type")) {
                    "Point" -> target.addMarker(id,f.optString("text",""),coords.getDouble(1),coords.getDouble(0),color)
                    "LineString" -> line(coords)
                    "Polygon" -> {
                        for(k in 0 until coords.length())line(coords.getJSONArray(k),":ring$k")
                        if(coords.length()==1) { val boundary=coords.getJSONArray(0)
                            target.replaceArea("$id:fill",(0 until boundary.length()).map { boundary.getJSONArray(it).let { p->p.getDouble(1) to p.getDouble(0) } },(color and 0x00ffffff) or 0x1f000000)
                        }
                    }
                }
            }
        }
    }

    private fun pickObject(target:NativeMapController,x:Float,y:Float) {
        if(boxOverlay!=null || chrome.currentPanel()!=null)return
        target.pickObjectIds(android.graphics.RectF(x,y,x,y)) { ids ->
            if(destroyed || gestureActive || chrome.currentPanel()!=null)return@pickObjectIds
            ids.firstOrNull{it.startsWith("geology:")}?.let{target.selectGeology(it);openGeology();return@pickObjectIds}
            ids.firstOrNull{it.startsWith("shantu-photo:")}?.let{photoPanel.showPhoto(it.removePrefix("shantu-photo:"));return@pickObjectIds}
            val refs=ids.mapNotNull(objectRefs::get).distinct()
            val core=store.load().getJSONObject("core")
            val found=refs.mapNotNull { ref ->
                val items=core.optJSONArray(ref.container) ?: return@mapNotNull null
                (0 until items.length()).map { items.getJSONObject(it) }.firstOrNull { it.optString("id")==ref.id }?.let { ref to it }
            }
            if(found.size==1)objectDetails(found[0].first.container,found[0].second)
            else if(found.size>1)AlertDialog.Builder(this).setTitle("选择地图对象").setItems(found.map { it.second.optString("name","地图对象") }.toTypedArray()) { _,i -> objectDetails(found[i].first.container,found[i].second) }.setNegativeButton("取消",null).show()
        }
    }
    private fun stopBoxSelection() {
        boxPickGeneration++
        boxOverlay?.let { (it.parent as? android.view.ViewGroup)?.removeView(it) };boxOverlay=null;boxPending=false;boxRefs=emptyList()
        chrome.setTaskActive(drawing);if(chrome.currentPanel()=="box")chrome.closePanel()
    }
    private fun openBoxSelection() {
        if(boxOverlay!=null) { stopBoxSelection();return }
        chrome.closePanel();geometryPanel.stopPicking();drawing=false
        val target=map
        val overlay=com.shantu.nativeapp.ui.NativeBoxSelectionView(this) { rect ->
            val generation=++boxPickGeneration
            boxPending=true;chrome.findViewWithTag<android.widget.TextView>("box-count")?.text="正在选择…"
            target.pickObjectIds(rect) { ids ->
                if(destroyed || boxOverlay==null || generation!=boxPickGeneration)return@pickObjectIds
                boxPending=false;boxRefs=ids.mapNotNull(objectRefs::get).distinct()
                chrome.findViewWithTag<android.widget.TextView>("box-count")?.text="已框选 ${boxRefs.size} 项"
            }
        }
        boxOverlay=overlay;mapRoot.addView(overlay,mapRoot.indexOfChild(chrome),FrameLayout.LayoutParams(-1,-1))
        chrome.setTaskActive(true)
        chrome.showPanel("box","框选对象",topAligned=true,width=220) {
            addOnAttachStateChangeListener(object:android.view.View.OnAttachStateChangeListener {
                override fun onViewAttachedToWindow(v:android.view.View){}
                override fun onViewDetachedFromWindow(v:android.view.View){if(boxOverlay===overlay) {
                    boxPickGeneration++;mapRoot.removeView(overlay);boxOverlay=null;boxPending=false;boxRefs=emptyList();chrome.setTaskActive(drawing)
                }}
            })
            addView(chrome.text("拖动地图框选对象",12).apply { tag="box-count" })
            addView(chrome.row("管理选中对象") {
                if(boxPending)toast("正在读取选择结果") else if(boxRefs.isEmpty())toast("尚未选中对象") else {
                    val selected=boxRefs;stopBoxSelection();collectionPanel.showSelection(selected)
                }
            })
            addView(chrome.row("退出框选") { stopBoxSelection() })
        }
    }

    private fun openComparison() {
        chrome.closePanel()
        if(secondaryMap==null) {
            val second=NativeMapController(this,tiandituKey,map.tileNetwork()) { }
            secondaryMap=second
            configureGeology(second);applyRasterPreferences(second);updatePosition()
            mapRoot.addView(second.view,1,FrameLayout.LayoutParams(1,1))
            val taps=GestureDetector(this,object:GestureDetector.SimpleOnGestureListener(){
                override fun onSingleTapConfirmed(event:MotionEvent):Boolean {
                    if(!drawing) { pickObject(second,event.x,event.y);return false }
                    val point=second.screenToCoordinate(event.x,event.y) ?: return false
                    nativeDrawing.onMapPoint(point.second,point.first)
                    return true
                }
            })
            val freehand=freehandInput(second)
            second.view.setOnTouchListener { _,event ->
                if(event.actionMasked==MotionEvent.ACTION_DOWN) { activePane=1;drawingMap=second;comparisonPanel?.setActivePane(1);gestureActive=true }
                val drawingStroke=freehand.onTouch(event)
                if(!drawingStroke)taps.onTouchEvent(event)
                if(event.actionMasked==MotionEvent.ACTION_UP||event.actionMasked==MotionEvent.ACTION_CANCEL) gestureActive=false
                drawingStroke
            }
            comparisonPanel=NativeDualMapPanel(this,chrome,map,second,choices={
                listOf(
                    NativeDualMapChoice(NativeMapController.SOURCE_IMAGERY,"天地图影像",NativeDualMapGroup.BUILTIN,sourceId=NativeMapController.SOURCE_IMAGERY),
                    NativeDualMapChoice(NativeMapController.SOURCE_VECTOR,"天地图矢量",NativeDualMapGroup.BUILTIN,sourceId=NativeMapController.SOURCE_VECTOR),
                    NativeDualMapChoice(NativeMapController.SOURCE_TERRAIN,"天地图地形",NativeDualMapGroup.BUILTIN,sourceId=NativeMapController.SOURCE_TERRAIN),
                )+sourceCatalog.sources.map { NativeDualMapChoice(it.id,it.name,NativeDualMapGroup.PRIVATE,source=it) }+
                    publicSourceCatalog.sources.map { NativeDualMapChoice(it.id,it.name,NativeDualMapGroup.PUBLIC,source=it) }
            },callbacks=NativeDualMapPanel.Callbacks(
                onPaneBoundsChanged={ bounds ->
                    if(bounds==null) {
                        map.view.layoutParams=FrameLayout.LayoutParams(-1,-1)
                        second.view.visibility=android.view.View.GONE;second.onPause()
                    } else {
                        fun params(rect:com.shantu.nativeapp.ui.NativeMapRectPx)=FrameLayout.LayoutParams(rect.width,rect.height).apply { leftMargin=rect.left;topMargin=rect.top }
                        map.view.layoutParams=params(bounds.primary);second.view.layoutParams=params(bounds.secondary);second.view.visibility=android.view.View.VISIBLE
                    }
                },onUseSource={ choice ->
                    if(choice.source!=null) map.setCustomSource(choice.source) else choice.sourceId?.let(map::setSource)
                    preferences.edit().putString("source",choice.source?.id ?: choice.sourceId).apply()
                },onExit={ camera ->
                    comparisonActive=false;handler.removeCallbacks(comparisonTick);drawingMap=null
                    chrome.setComparisonMode(false);map.restoreCamera(camera)
                },onActivePaneChanged={ activePane=it },onObjectTargetChanged={ pane -> activePane=pane;drawingMap=if(pane==0)map else second },
                onFollow={ requireLocation("follow") },onStopFollow={ follow=false;navigationPanel.setFollowing(false) },
                onAction={ pane,action ->
                    val target=if(pane==0)map else second;activePane=pane;drawingMap=target
                    when(action) {
                        "mark" -> { val c=target.cameraSnapshot();markerPanel(NativePlace("",c.longitude,c.latitude)) }
                        "draw" -> { geometryPanel.stopPicking();drawingPanel() }
                        "direction" -> direction(target)
                        "toggle-follow" -> { if(follow) { follow=false;navigationPanel.setFollowing(false) } else requireLocation("follow") }
                    }
                    comparisonPanel?.onCameraChanged(pane,target.cameraSnapshot())
                }
            ))
        }
        comparisonActive=true;activePane=0
        secondaryMap!!.apply { synchronizeCameraFrom(map);setQuality(map.currentQuality());onResume() }
        chrome.setComparisonMode(true)
        comparisonPanel!!.open(chrome.width,chrome.height)
        renderWorkspace();handler.removeCallbacks(comparisonTick);handler.post(comparisonTick)
    }

    private fun freehandInput(target:NativeMapController)=com.shantu.nativeapp.ui.NativeFreehandGesture(
        spacingPx=chrome.dp(4).toFloat(),
        enabled={drawing && nativeDrawing.acceptsFreehand && !chrome.locked},
        project={x,y->target.screenToCoordinate(x,y)?.let { (lat,lon)->com.shantu.nativeapp.navigation.NativeCoordinate(lon,lat) }},
        commit={points->nativeDrawing.onFreehandStroke(points);Unit},
    )

    private fun prepareDocumentExport(bytes:ByteArray,name:String,mime:String) {
        val filename=UUID.randomUUID().toString()+".export"
        filesExecutor.execute {
            val result=runCatching {cacheDir.resolve("pending-exports").apply {mkdirs()}.resolve(filename).writeBytes(bytes)}
            handler.post {if(!destroyed)result.onSuccess {
                documentExportFile=filename
                startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {type=mime;addCategory(Intent.CATEGORY_OPENABLE);putExtra(Intent.EXTRA_TITLE,name)},112)
            }.onFailure {toast("导出文件未生成，原项目保留")}}
        }
    }

    private fun showRouteQr(track:JSONObject) {
        filesExecutor.execute {
            val generated=runCatching {
                val encoded=com.shantu.nativeapp.data.NativeRouteQr.encode(track)
                val matrix=com.google.zxing.qrcode.QRCodeWriter().encode(encoded.text,com.google.zxing.BarcodeFormat.QR_CODE,1024,1024,
                    mapOf(com.google.zxing.EncodeHintType.ERROR_CORRECTION to com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M,com.google.zxing.EncodeHintType.MARGIN to 4))
                val bitmap=android.graphics.Bitmap.createBitmap(1024,1024,android.graphics.Bitmap.Config.ARGB_8888)
                val pixels=IntArray(1024*1024){index->if(matrix.get(index%1024,index/1024))Color.BLACK else Color.WHITE}
                bitmap.setPixels(pixels,0,1024,0,0,1024,1024)
                val bytes=java.io.ByteArrayOutputStream().also {bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}.toByteArray()
                Triple(encoded,bitmap,bytes)
            }
            handler.post {
                if(destroyed){generated.getOrNull()?.second?.recycle();return@post}
                generated.onSuccess {(encoded,bitmap,bytes)->
                    val body=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL;setPadding(chrome.dp(8),chrome.dp(8),chrome.dp(8),chrome.dp(8))}
                    body.addView(android.widget.ImageView(this).apply {setImageBitmap(bitmap);adjustViewBounds=true},LinearLayout.LayoutParams(-1,chrome.dp(280)))
                    body.addView(android.widget.TextView(this).apply {text=encoded.explanation;textSize=12f})
                    val scroll=android.widget.ScrollView(this).apply {addView(body)}
                    AlertDialog.Builder(this).setTitle(track.optString("name","路线二维码")).setView(scroll)
                        .setPositiveButton("分享二维码") {_,_->shareBytes(bytes,"山兔路线二维码.png","image/png")}
                        .setNeutralButton("保存图片") {_,_->prepareDocumentExport(bytes,"山兔路线二维码.png","image/png")}
                        .setNegativeButton("关闭",null).setOnDismissListener {bitmap.recycle()}.show()
                }.onFailure {toast(it.message?.take(160) ?: "路线无法生成单个二维码，请导出完整路线文件")}
            }
        }
    }

    private fun acceptQrText(text:String) {
        if(text.startsWith(com.shantu.nativeapp.data.NativeRouteQr.PREFIX)) {
            val parsed=runCatching { com.shantu.nativeapp.data.NativeRouteQr.decode(text) }
            parsed.onSuccess {track ->
                AlertDialog.Builder(this).setTitle("导入扫码路线").setMessage(track.getString("name")+"\n仅保存路线，导航需另行启动。")
                    .setNegativeButton("取消",null).setPositiveButton("保存") {_,_->
                        runCatching {store.upsert("tracks",track)}.onSuccess {renderWorkspace();collections()}.onFailure {toast("二维码路线校验未通过，未保存")}
                    }.show()
            }.onFailure {toast("路线二维码损坏、超限或格式不受支持")}
        } else {
            val result=runCatching {NativeSourceImport.parseScannedText(text)}
            result.onSuccess {
                if(sourceEditor==null || chrome.currentPanel()!="source-editor")editSources()
                sourceEditor?.acceptImport(it)?.let { update->toast(update.message) }
            }.onFailure {toast("不是支持的路线或图源二维码")}
        }
    }

    private fun importFile() = startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type = "application/json"; addCategory(Intent.CATEGORY_OPENABLE) }, 101)
    private fun exportFile() = startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { type = "application/json"; addCategory(Intent.CATEGORY_OPENABLE); putExtra(Intent.EXTRA_TITLE, "山兔完整工程.json") }, 102)
    private fun importRouteFile() = startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        type = "*/*"; addCategory(Intent.CATEGORY_OPENABLE)
    }, 103)
    private fun exportRouteFile(format: NativeRouteFormats.Format) {
        exportFormat = format
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            type = when(format){NativeRouteFormats.Format.GPX->"application/gpx+xml";NativeRouteFormats.Format.KML->"application/vnd.google-earth.kml+xml";else->"application/geo+json"}
            addCategory(Intent.CATEGORY_OPENABLE)
            putExtra(Intent.EXTRA_TITLE, "山兔路线.${format.name.lowercase()}")
        }, 104)
    }
    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("incomingHandled",incomingHandled)
        outState.putString("industryKind",industryKind)
        outState.putString("documentExportFile",documentExportFile)
        outState.putString("exportFormat", exportFormat.name)
        outState.putString("pendingCameraFile",pendingCameraFile)
        super.onSaveInstanceState(outState)
    }
    override fun onNewIntent(intent:Intent) {
        super.onNewIntent(intent);setIntent(intent);incomingHandled=false
        if(::store.isInitialized)offerIncomingDocument(intent)
    }
    private fun offerIncomingDocument(incoming:Intent?) {
        if(incomingHandled || destroyed)return
        val uri=com.shantu.nativeapp.data.NativeIncomingDocument.uri(incoming) ?: return
        incomingHandled=true
        runCatching {contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)}
        filesExecutor.execute {
            val name=runCatching {contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use {if(it.moveToFirst())it.getString(0)else null}}
                .getOrNull()?.take(160) ?: "共享文件"
            handler.post {if(!destroyed) {
                AlertDialog.Builder(this).setTitle("导入：$name")
                    .setItems(arrayOf("路线 / 地点文件","完整工程 / 旧版备份","地图图源配置","CAD工程图","行业XLSX工作簿")) {_,index->
                        when(index) {
                            0->processDocument(uri,103,exportFormat)
                            1->AlertDialog.Builder(this).setTitle("导入工程数据")
                                .setMessage("完整工程同ID对象采用导入侧内容；旧v1备份冲突保留副本。本机独有对象会保留。")
                                .setPositiveButton("导入"){_,_->processDocument(uri,101,exportFormat)}.setNegativeButton("取消",null).show()
                            2->{editSources();importSourceFile(uri)}
                            3->importCad(uri)
                            4->AlertDialog.Builder(this).setTitle("工作簿类型").setItems(arrayOf("实测剖面","钻孔柱状图")) {_,kind->industryKind=if(kind==0)"section" else "drill";importIndustry(uri)}.show()
                        }
                    }.setNegativeButton("取消",null).show()
            }}
        }
    }
    @Deprecated("Legacy Activity result API retained for dependency-light native validation")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if(requestCode==107) {
            val file=cameraFile(); pendingCameraFile=null
            if(resultCode==RESULT_OK && file?.isFile==true && file.length()>0) importPhoto(androidx.core.content.FileProvider.getUriForFile(this,"$packageName.files",file))
            else toast("拍照已取消，未添加照片")
            return
        }
        if(requestCode==110) {
            if(resultCode==RESULT_OK)data?.getStringExtra("decoded")?.let(::acceptQrText)
            return
        }
        if(resultCode==RESULT_OK && requestCode==106 && data?.clipData!=null){val clip=data.clipData!!;importPhotoBatch((0 until clip.itemCount).map{clip.getItemAt(it).uri});return}
        val uri = data?.data ?: return; if (resultCode != RESULT_OK) return
        if(requestCode==116){
            runCatching{contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)}
            filesExecutor.execute{
                val result=runCatching{com.shantu.nativeapp.photos.NativePhotoFolder.list(contentResolver,uri)}
                handler.post{if(!destroyed)result.onSuccess(::importPhotoBatch).onFailure{toast(it.message?:"照片目录无法读取")}}
            };return
        }
        if(requestCode==106) { importPhoto(uri); return }
        if(requestCode==108) { importSourceFile(uri); return }
        if(requestCode==109) { importCad(uri);return }
        if(requestCode==111) {importIndustry(uri);return}
        if(requestCode==113) {
            filesExecutor.execute{
                val r=runCatching{contentResolver.openInputStream(uri)?.use{input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(16384);while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=com.shantu.nativeapp.offlineRouting.NativeOfflineRouting.MAX_BYTES){"路网文件过大"};out.write(buffer,0,n)};offlineRouting.import(out.toByteArray())}?:error("无法读取路网")}
                handler.post{if(!destroyed){r.onSuccess{openOfflineRouting()}.onFailure{toast(it.message?:"路网未导入")}}}
            };return
        }
        if(requestCode==117){
            filesExecutor.execute{
                val result=runCatching{contentResolver.openInputStream(uri)?.use{input->NativePhotoImporter.readBounded(input,2_000_000).toString(Charsets.UTF_8)}?:error("无法读取布局")}
                handler.post{if(!destroyed)result.onSuccess{raw->runCatching{layoutEditor?.importDraft(raw)}.onFailure{toast(it.message?:"布局未导入")}}.onFailure{toast(it.message?:"布局未导入")}}
            };return
        }
        if(requestCode==118){pendingGeorefImage=uri;pendingWorldFile="";runCatching{contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)};imageGeoreferencing();return}
        if(requestCode==119){filesExecutor.execute{val r=runCatching{contentResolver.openInputStream(uri)?.use{NativePhotoImporter.readBounded(it,16384).toString(Charsets.UTF_8)}?:error("世界文件不可读")};handler.post{if(!destroyed)r.onSuccess{pendingWorldFile=it;imageGeoreferencing()}.onFailure{toast(it.message?:"世界文件未读取")}}};return}
        if(requestCode==120){val input=contentResolver.openInputStream(uri)?:return;if(taskMigrationPanel==null)openTaskMigration();taskMigrationPanel?.receiveMigration(input);return}
        if(requestCode==114||requestCode==115){
            filesExecutor.execute{
                val result=runCatching{
                    val name=contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())it.getString(0)else null}?:"离线地图"
                    val input=contentResolver.openInputStream(uri)?:error("文件无法打开")
                    input.use{if(requestCode==114)offlineMapStore.importFile(name,it)else legacyArchive.importZip(it)}
                }
                handler.post{if(!destroyed){result.onSuccess{reloadSourceCatalog();openOfflineMaps();toast("已导入本机离线存储")}.onFailure{AlertDialog.Builder(this).setTitle("文件未导入").setMessage(it.message?:"格式无效，原文件保留").setPositiveButton("关闭",null).show()}}}
            };return
        }
        if(requestCode==112) {
            val name=documentExportFile?.takeIf {it.matches(Regex("[a-f0-9-]+\\.export"))} ?: return;documentExportFile=null
            filesExecutor.execute {
                val file=cacheDir.resolve("pending-exports").resolve(name)
                val result=runCatching {contentResolver.openOutputStream(uri)?.use {out->file.inputStream().use {it.copyTo(out)};out.flush()} ?: error("无法写入")}
                if(result.isSuccess)file.delete()
                handler.post {if(!destroyed)toast(if(result.isSuccess)"文件已导出" else "导出失败，原项目保留")}
            };return
        }
        if(requestCode !in 101..104) return
        processDocument(uri, requestCode, exportFormat)
    }
    private class CoordinateChoiceNeeded : IllegalArgumentException()
    private fun processDocument(uri: android.net.Uri, requestCode: Int, format: NativeRouteFormats.Format,
        options: NativeRouteFormats.ImportOptions = NativeRouteFormats.ImportOptions()) {
        filesExecutor.execute {
            val result = runCatching {
                when (requestCode) {
                    101 -> {
                        val summary = contentResolver.openInputStream(uri)?.use { store.importWorkspace(it) } ?: error("无法打开文件")
                        val importedSettings=store.load().optJSONObject("settings")?:JSONObject()
                        if(importedSettings.length()>0)com.shantu.nativeapp.data.NativeImportedSettings.apply(this,importedSettings)
                        val warnings=materializeWorkspaceMaps()
                        "工程已导入：新增 ${summary.added.values.sum()} 项，更新 ${summary.overwritten.values.sum()} 项"+warnings.takeIf{it.isNotEmpty()}?.joinToString("\n",prefix="\n部分文件图源需处理：\n").orEmpty()
                    }
                    102 -> {
                        val export=exportWorkspaceWithMaps()
                        contentResolver.openOutputStream(uri)?.use { it.write(export.toString().toByteArray(Charsets.UTF_8));it.flush() } ?: error("无法创建文件")
                        "工程已导出"
                    }
                    103 -> {
                        val filename = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                            if (cursor.moveToFirst()) cursor.getString(0) else null
                        } ?: uri.lastPathSegment.orEmpty()
                        if (filename.substringAfterLast('.').lowercase() in listOf("ovkml", "ovkmz") && options.coordinateSystem == NativeRouteFormats.CoordinateSystem.AUTO)
                            throw CoordinateChoiceNeeded()
                        val parsed = contentResolver.openInputStream(uri)?.use { NativeRouteFormats.importFile(it, filename, options) } ?: error("无法打开文件")
                        val summary = store.importRoutes(parsed.data)
                        (listOf("文件已导入：新增 ${summary.added.values.sum()} 项，更新 ${summary.overwritten.values.sum()} 项") + parsed.warnings).joinToString("\n")
                    }
                    else -> {
                        val bytes = store.exportRoutes(format)
                        contentResolver.openOutputStream(uri)?.use { it.write(bytes); it.flush() } ?: error("无法创建文件")
                        "${format.name} 已导出"
                    }
                }
            }
            runOnUiThread { if (!destroyed) { if (result.isSuccess) {
                reloadSourceCatalog();if(requestCode==101)applyRuntimeSettings();refreshPhotos();refreshCad(); renderWorkspace(); collections()
                AlertDialog.Builder(this).setTitle("文件操作完成").setMessage(result.getOrThrow()).setPositiveButton("关闭", null).show()
            }
                else if (result.exceptionOrNull() is CoordinateChoiceNeeded) {
                    AlertDialog.Builder(this).setTitle("奥维文件的坐标系")
                        .setMessage("请按奥维导出时的设置选择，选择错误会导致位置偏移。")
                        .setPositiveButton("CGCS2000") { _, _ -> processDocument(uri, requestCode, format, NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.CGCS2000)) }
                        .setNeutralButton("GCJ02") { _, _ -> processDocument(uri, requestCode, format, NativeRouteFormats.ImportOptions(NativeRouteFormats.CoordinateSystem.GCJ02)) }
                        .setNegativeButton("取消", null).show()
                } else AlertDialog.Builder(this).setTitle("操作未完成").setMessage("文件格式不受支持、校验失败或无法写入。已有原生存档保留；旧版存档未修改。").setPositiveButton("关闭", null).show() } }
        }
    }

    private fun objectDetails(container: String, item: JSONObject) {
        chrome.showPanel("object", item.optString("name", "已保存对象")) {
            if(container=="favorites") addView(chrome.row("沿原路线导航") { startNavigation(item.getJSONObject("route"),item.optString("name","路线导航")) })
            if(container=="tracks")addView(chrome.row("沿该轨迹导航") {navigateTrack(item)})
            if(container in listOf("tracks","favorites")) {
                addView(chrome.row("查看全程") {viewTrack(item)})
                addView(chrome.row("分享路线与关联照片") {shareSelection(listOf(CollectionRecordRef(container,item.getString("id"))))})
            }
            if (container == "favorites" || container == "tracks") addView(chrome.row("缓存沿线地图") {
                val route = item.optJSONObject("route")?.optJSONArray("coordinates")
                // Segment breaks are not joined: each disconnected segment can be cached explicitly.
                val segments = item.optJSONArray("segments")
                fun open(points: JSONArray) = cachePanel.create((0 until points.length()).map { i ->
                    points.getJSONArray(i).let { it.getDouble(0) to it.getDouble(1) }
                }, item.optString("name","沿线地图"))
                if (route != null) open(route)
                else if (segments != null && segments.length() > 1) AlertDialog.Builder(this@MainActivity)
                    .setTitle("选择路线分段").setItems(Array(segments.length()) { "第 ${it+1} 段" }) { _,index -> open(segments.getJSONArray(index)) }.show()
                else if (segments != null && segments.length()==1) open(segments.getJSONArray(0))
                else toast("路线没有可缓存的坐标")
            })
            addView(chrome.row("在地图查看") {
                val point = item.optJSONArray("coordinates") ?: item.optJSONArray("segments")?.optJSONArray(0)?.optJSONArray(0)
                    ?: item.optJSONObject("route")?.optJSONArray("coordinates")?.optJSONArray(0)
                    ?: item.optJSONArray("boundary")?.optJSONArray(0) ?: item.optJSONArray("points")?.optJSONObject(0)?.optJSONArray("coordinates")
                if (point != null) map.centerTo(point.getDouble(1), point.getDouble(0))
                chrome.closePanel()
            })
            if(container=="tracks")addView(chrome.row("路线二维码") {showRouteQr(item)})
            if(container=="tracks")addView(chrome.row("编辑线条节点 / 继续画线") {nativeDrawing.continueFrom(item)})
            if(container=="tracks"||container=="favorites")addView(chrome.row("路线颜色 / 图例 / 统计 / 高程图"){
                val track=if(container=="tracks")item else JSONObject(item.getJSONObject("route").toString()).put("segments",JSONArray().put(item.getJSONObject("route").getJSONArray("coordinates")))
                openRouteDisplay(track,CollectionRecordRef(container,item.getString("id")))
            })
            addView(chrome.row("编辑名称、说明和样式") {
                val editor = NativeObjectEditor(this@MainActivity, chrome,onOpenMapGizmo=::openObjectGizmo)
                val save: (JSONObject) -> Unit = { updated ->
                    runCatching { store.upsert(container, updated) }
                        .onSuccess { runCatching { renderWorkspace(); collections() }.onFailure { toast("已保存，地图显示刷新失败，请重新打开收藏") } }
                        .onFailure { toast("保存失败，请核对输入；原对象已保留") }
                }
                val delete: (JSONObject) -> Unit = { original ->
                    runCatching { store.remove(container, original.getString("id")) }
                        .onSuccess { runCatching { renderWorkspace(); collections() }.onFailure { toast("已删除，地图显示刷新失败，请重新打开收藏") } }
                        .onFailure { toast("删除未完成，原对象已保留") }
                }
                when (container) {
                    "areas", "measurements" -> { drawing = false; geometryPanel.open(container, item) }
                    "sections" -> if(item.optJSONObject("settings")?.has("survey")==true)openSurveySection(item)else openSections()
                    "annotations" -> editor.showMarker(item, save, delete)
                    "favorites" -> {
                        val route = item.getJSONObject("route")
                        val editable = JSONObject(item.toString()).put("style", route.optJSONObject("style") ?: JSONObject().put("color", "#d0f76b").put("width", 1.5).put("opacity", 1.0))
                        editor.showTrack(editable, { changed ->
                            val next = JSONObject(item.toString()).put("name", changed.getString("name")).put("hidden", changed.optBoolean("hidden", false))
                            next.getJSONObject("route").put("style", changed.getJSONObject("style"))
                            save(next)
                        }, delete)
                    }
                    else -> editor.showTrack(item, save, delete)
                }
            })
            val usesVisible = container in listOf("annotations", "areas", "measurements")
            val visible = if (usesVisible) item.optBoolean("visible", true) else !item.optBoolean("hidden", false)
            addView(chrome.row(if (visible) "在地图隐藏" else "在地图显示") {
                val updated = JSONObject(item.toString())
                if (usesVisible) updated.put("visible", !visible) else updated.put("hidden", visible)
                runCatching { store.upsert(container, updated); renderWorkspace(); objectDetails(container, updated) }
                    .onFailure { toast("显示设置未保存") }
            })
            addView(chrome.row("返回收藏") { collections() })
        }
    }
    private fun openObjectGizmo(draft:JSONObject,onSave:(JSONObject)->Unit){
        val input=JSONObject(draft.toString())
        if(input.optString("kind")!="pin"&&input.isNull("groundElevation"))input.optJSONArray("coordinates")?.let{c->map.getElevation(c.optDouble(1),c.optDouble(0))?.let{input.put("groundElevation",it)}}
        val pose=com.shantu.nativeapp.ui.NativeObjectPose.fromAnnotation(input)
        if(pose==null){toast("模型需要有效坐标和真实地面高程，请等待地形加载后再试");return}
        chrome.closePanel();chrome.setTaskActive(true)
        fun close(){objectGizmo?.let{mapRoot.removeView(it)};objectGizmo=null;chrome.setTaskActive(drawing);renderWorkspace()}
        val overlay=com.shantu.nativeapp.ui.NativeObjectGizmo(this,chrome,pose,input.optString("kind"),map.objectGizmoAdapter(),
            onPreview={p->p.applyTo(input)?.let{map.renderMarker(it);secondaryMap?.renderMarker(it)}},
            onSave={p->p.applyTo(input)?.let{updated->close();onSave(updated)}},onCancel={close()})
        objectGizmo=overlay;mapRoot.addView(overlay,FrameLayout.LayoutParams(-1,-1))
    }

    private fun startNavigation(route: JSONObject, title: String) {
        fun begin() {
            navigationPanel.start(route,title)
            if(!navigationPanel.isActive()) return
            pendingNavigationRecord = RecordingFacade.sampling(this).optBoolean("recordOnNavigation") && RecordingFacade.snapshot(this).optString("phase")=="idle"
            requireLocation("follow")
            lastLocation?.let(navigationPanel::onLocation)
        }
        if(navigationPanel.isActive()) AlertDialog.Builder(this).setTitle("切换导航路线？")
            .setMessage("当前导航将结束，已保存路线和记录保持不变。")
            .setNegativeButton("取消",null).setPositiveButton("切换") { _,_ -> begin() }.show()
        else begin()
    }
    private fun requireLocation(action: String) {
        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            pendingPermissionAction = action; requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION), 201); return
        }
        if (action == "follow") {
            follow = true
            runCatching { for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER))
                if (locationManager.isProviderEnabled(provider)) locationManager.requestLocationUpdates(provider, 1000, 0f, this)
            }.onFailure { follow = false; toast("无法获取定位，请检查系统定位开关。") }
            if (::navigationPanel.isInitialized) navigationPanel.setFollowing(follow)
            lastLocation?.let { onLocationChanged(it) } ?: run { chrome.status.text = "等待设备定位信号" }
            if(pendingNavigationRecord) { pendingNavigationRecord=false; requireLocation("start") }
        } else {
            recordCommand(action)
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 202)
        }
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if(requestCode==203){if(checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED)takePhoto()else toast("未获得相机权限，未拍照")}
        if (requestCode == 201) { val action = pendingPermissionAction; pendingPermissionAction = null
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED && action != null) requireLocation(action)
            else { pendingNavigationRecord=false; toast("未取得精确定位权限，未开始记录或跟随。") } }
    }
    override fun onLocationChanged(location: Location) {
        if (!location.hasAccuracy() || location.accuracy < 0 || location.accuracy > 100 || System.currentTimeMillis() - location.time !in 0..20000) return
        lastLocation = Location(location)
        motionHeading.update(positionFix(location),System.currentTimeMillis())
        updatePosition()
        if (::navigationPanel.isInitialized) navigationPanel.onLocation(location)
        if (follow && !gestureActive) map.centerTo(location.latitude, location.longitude)
    }
    override fun onProviderDisabled(provider: String) { if (follow) chrome.status.text = "定位信号不可用，等待恢复"; if (::navigationPanel.isInitialized) navigationPanel.onLocationError("定位信号不可用，等待恢复") }
    override fun onProviderEnabled(provider: String) {}
    @Deprecated("Legacy platform callback") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    private fun positionFix(l:Location)=com.shantu.nativeapp.map.NativePositionFix(l.latitude,l.longitude,l.accuracy.toDouble(),l.time,l.provider?:"unknown",
        l.speed.takeIf{l.hasSpeed()}?.toDouble(),l.bearing.takeIf{l.hasBearing()}?.toDouble(),l.bearingAccuracyDegrees.takeIf{l.hasBearingAccuracy()}?.toDouble())
    private fun updatePosition(){
        val now=System.currentTimeMillis()
        val state=com.shantu.nativeapp.map.NativePositionState(lastLocation?.let(::positionFix),now,motionHeading.heading,
            com.shantu.nativeapp.map.NativeHeadingSource.MOTION,motionHeading.acceptedAt,mode=directionMode)
        map.setPosition(state);secondaryMap?.setPosition(state)
        if(!gestureActive){
            val heading=when(directionMode){
                com.shantu.nativeapp.map.NativeDirectionMode.NORTH->0.0
                com.shantu.nativeapp.map.NativeDirectionMode.DEVICE->compassHeading?.takeIf{now-compassAt in 0..3000}
                com.shantu.nativeapp.map.NativeDirectionMode.MOTION->motionHeading.heading?.takeIf{now-motionHeading.acceptedAt in 0..10_000}
                else->null
            }
            heading?.let{ map.setHeading(it);secondaryMap?.setHeading(it) }
        }
    }
    private fun freeCameraDirection(){directionMode=com.shantu.nativeapp.map.NativeDirectionMode.FREE;preferences.edit().putString("direction-mode",directionMode.name).apply()}
    private fun updateSensors(){
        if(sensorActive){sensorManager.unregisterListener(this);sensorActive=false}
        if(foreground && directionMode==com.shantu.nativeapp.map.NativeDirectionMode.DEVICE){
            val sensor=sensorManager.getDefaultSensor(android.hardware.Sensor.TYPE_ROTATION_VECTOR)
            if(sensor==null)chrome.status.text="设备没有可用的方向传感器"
            else sensorActive=sensorManager.registerListener(this,sensor,android.hardware.SensorManager.SENSOR_DELAY_UI)
        }
    }
    override fun onSensorChanged(event:android.hardware.SensorEvent){
        if(event.sensor.type!=android.hardware.Sensor.TYPE_ROTATION_VECTOR || event.accuracy==android.hardware.SensorManager.SENSOR_STATUS_UNRELIABLE)return
        val rotation=FloatArray(9);val adjusted=FloatArray(9);val angles=FloatArray(3)
        android.hardware.SensorManager.getRotationMatrixFromVector(rotation,event.values)
        @Suppress("DEPRECATION") val displayRotation=windowManager.defaultDisplay.rotation
        val axes=when(displayRotation){android.view.Surface.ROTATION_90->android.hardware.SensorManager.AXIS_Y to android.hardware.SensorManager.AXIS_MINUS_X;android.view.Surface.ROTATION_180->android.hardware.SensorManager.AXIS_MINUS_X to android.hardware.SensorManager.AXIS_MINUS_Y;android.view.Surface.ROTATION_270->android.hardware.SensorManager.AXIS_MINUS_Y to android.hardware.SensorManager.AXIS_X;else->android.hardware.SensorManager.AXIS_X to android.hardware.SensorManager.AXIS_Y}
        android.hardware.SensorManager.remapCoordinateSystem(rotation,axes.first,axes.second,adjusted)
        android.hardware.SensorManager.getOrientation(adjusted,angles)
        val declination=lastLocation?.let{android.hardware.GeomagneticField(it.latitude.toFloat(),it.longitude.toFloat(),if(it.hasAltitude())it.altitude.toFloat() else 0f,System.currentTimeMillis()).declination}?:0f
        compassHeading=(Math.toDegrees(angles[0].toDouble())+declination+360)%360;compassAt=System.currentTimeMillis()
        if(::map.isInitialized)updatePosition()
    }
    override fun onAccuracyChanged(sensor:android.hardware.Sensor?,accuracy:Int){if(accuracy==android.hardware.SensorManager.SENSOR_STATUS_UNRELIABLE){compassHeading=null;compassAt=0}}
    override fun onResume() { super.onResume();foreground=true;updateSensors(); if (::map.isInitialized) map.onResume();if(comparisonActive) secondaryMap?.onResume() }
    override fun onPause() {
        foreground=false;updateSensors()
        if (::map.isInitialized) {
            runCatching { val c = map.cameraSnapshot(); preferences.edit().putString("camera", JSONObject().put("latitude", c.latitude).put("longitude", c.longitude)
                .put("range", c.rangeMeters).put("heading", c.headingDegrees).put("pitch", c.pitchDegrees).toString()).apply() }
            map.onPause()
        }
        super.onPause()
        secondaryMap?.onPause()
    }
    @Deprecated("Legacy Activity back API") override fun onBackPressed() {
        if(objectGizmo!=null)objectGizmo?.cancel()
        else if(chrome.currentPanel()=="layout-editor"){layoutEditor?.cancel();chrome.closePanel()}
        else if (::chrome.isInitialized && chrome.locked) chrome.setLocked(false)
        else if (::chrome.isInitialized && chrome.currentPanel() != null) chrome.closePanel()
        else if(comparisonActive) comparisonPanel?.close()
        else super.onBackPressed()
    }
    override fun onDestroy() {
        destroyed = true; handler.removeCallbacksAndMessages(null)
        if (::locationManager.isInitialized) runCatching { locationManager.removeUpdates(this) }
        if (::navigationPanel.isInitialized) navigationPanel.dispose()
        comparisonPanel?.dispose();secondaryMap?.dispose()
        if (::map.isInitialized) map.dispose()
        if (::routePanel.isInitialized) routePanel.dispose()
        if (::cachePanel.isInitialized) cachePanel.dispose()
        if (::photoPanel.isInitialized) photoPanel.dispose()
        if (::cadPanel.isInitialized) cadPanel.dispose()
        if (::nativeDrawing.isInitialized) nativeDrawing.dispose()
        if (::industryPanel.isInitialized) industryPanel.dispose()
        sectionPanel?.dispose();sectionSurface?.close()
        surveyPanel?.dispose();offlineRoutingPanel?.dispose()
        offlineMapsPanel?.dispose()
        taskMigrationPanel?.dispose()
        layoutEditor?.dispose()
        searchCancellation?.cancel(); searchTask?.cancel(true); searchExecutor.shutdownNow()
        filesExecutor.shutdown(); super.onDestroy()
    }
    private fun toast(message: String) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    private fun materializeWorkspaceMaps():List<String>{
        val maps=store.load().optJSONArray("mapSources")?:return emptyList()
        val bindings=runCatching{JSONObject(preferences.getString("offline-map-bindings","{}")!!)}.getOrDefault(JSONObject())
        val available=offlineMapStore.list().map{it.id}.toSet();val warnings=mutableListOf<String>()
        for(i in 0 until maps.length()){
            val source=maps.getJSONObject(i);if(source.optString("kind") !in listOf("mbtiles","image"))continue
            val original=source.optString("id");val blob=source.optString("blobBase64")
            val digest=java.security.MessageDigest.getInstance("SHA-256")
            for(offset in blob.indices step 8192)digest.update(blob.substring(offset,minOf(offset+8192,blob.length)).toByteArray(Charsets.UTF_8))
            val hash=digest.digest().joinToString(""){"%02x".format(it)}
            val prior=bindings.optJSONObject(original)
            if(prior?.optString("hash")==hash&&prior.optString("nativeId") in available)continue
            runCatching{offlineMapStore.importLegacyStoredMap(source)}.onSuccess{map->bindings.put(original,JSONObject().put("nativeId",map.id).put("hash",hash))}
                .onFailure{warnings+="${source.optString("name","文件图源")}：${it.message?:"未恢复"}"}
        }
        if(!preferences.edit().putString("offline-map-bindings",bindings.toString()).commit())warnings+="图源绑定保存失败；原始工程数据保留"
        return warnings
    }
    private fun exportWorkspaceWithMaps():JSONObject{
        val workspace=store.load();val maps=workspace.optJSONArray("mapSources")?:JSONArray();val records=linkedMapOf<String,JSONObject>()
        for(i in 0 until maps.length())maps.optJSONObject(i)?.let{records[it.optString("id")]=it}
        val bindings=runCatching{JSONObject(preferences.getString("offline-map-bindings","{}")!!)}.getOrDefault(JSONObject())
        val originals=bindings.keys().asSequence().associateBy{bindings.optJSONObject(it)?.optString("nativeId")}
        for(map in offlineMapStore.list()){
            val exported=offlineMapStore.exportLegacyStoredMap(map.id);val id=originals[map.id]?:map.id
            exported.put("id",id);records[id]=exported
        }
        return workspace.put("mapSources",JSONArray(records.values.toList()))
    }
    private fun saveProfilePng(name:String,bytes:ByteArray):Boolean{
        val safeName=name.substringAfterLast('/').substringAfterLast('\\').take(180).let{if(it.endsWith(".png",true))it else "$it.png"}
        val result=runCatching{
            if(Build.VERSION.SDK_INT>=29){
                val values=android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,safeName);put(android.provider.MediaStore.MediaColumns.MIME_TYPE,"image/png");put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,"Download/山兔");put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)}
                val uri=contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values)?:error("下载目录不可写")
                try{
                    contentResolver.openFileDescriptor(uri,"w")?.use{pfd->java.io.FileOutputStream(pfd.fileDescriptor).use{out->out.write(bytes);out.flush();out.fd.sync()}}?:error("无法写入图片")
                    check(contentResolver.update(uri,android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)},null,null)>0)
                }catch(e:Exception){contentResolver.delete(uri,null,null);throw e}
            }else{
                val dir=getExternalFilesDir(android.os.Environment.DIRECTORY_PICTURES)?:error("图片目录不可写")
                val file=java.io.File(dir,"${UUID.randomUUID()}-$safeName")
                java.io.FileOutputStream(file).use{it.write(bytes);it.flush();it.fd.sync()}
            }
        }
        handler.post{if(!destroyed)toast(if(result.isSuccess)"PNG已保存至${if(Build.VERSION.SDK_INT>=29)"下载/山兔" else "应用图片目录"}"else "PNG未保存，原数据保留")}
        return result.isSuccess
    }
    private fun applyRuntimeSettings(){
        terrain=preferences.getBoolean("terrain",true);contours=preferences.getBoolean("contours",false);elevationColors=preferences.getBoolean("elevation-colors",false);contourInterval=preferences.getInt("contour-interval",30)
        applySavedAppearance();chrome.setTerrainButton(terrain)
        for(target in listOfNotNull(map,secondaryMap)){
            target.setTerrain(terrain);target.setTerrainExaggeration(preferences.getFloat("terrain-exaggeration",1f).toDouble());target.setTerrainOverlay(contours,elevationColors,contourInterval,preferences.getFloat("elevation-opacity",1f).toDouble());applyRasterPreferences(target);applyGeology(target)
            val id=preferences.getString("source",NativeMapController.SOURCE_IMAGERY)!!
            if(id in NativeMapController.SOURCE_IDS)target.setSource(id)else(sourceCatalog.sources+publicSourceCatalog.sources).find{it.id==id}?.let(target::setCustomSource)
            target.setQuality(if(preferences.getString("quality","high")=="standard")NativeMapQuality.STANDARD else NativeMapQuality.HIGH)
            preferences.getString("legacy-view",null)?.let{target.restoreLegacyView(JSONObject(it))}
        }
    }
    private fun importPhotoBatch(uris:List<android.net.Uri>){
        if(uris.isEmpty()){toast("没有可导入照片");return}
        val tracks=store.load().getJSONObject("core").getJSONArray("tracks")
        val choices=(0 until tracks.length()).mapNotNull{runCatching{NativePhotoMatching.fromTrackJson(tracks.getJSONObject(it))}.getOrNull()}
        if(choices.isEmpty()){toast("请先保存带真实时间的轨迹，或从相册逐张关联标记");return}
        AlertDialog.Builder(this).setTitle("${uris.size}张照片 · 选择匹配轨迹")
            .setItems(choices.map{it.name}.toTypedArray()){_,index->
                val selected=choices[index];val canceled=android.os.CancellationSignal()
                val progress=chrome.text("准备导入…",12)
                val dialog=AlertDialog.Builder(this).setTitle("批量导入照片").setView(progress).setNegativeButton("停止"){_,_->canceled.cancel()}.create()
                dialog.setOnCancelListener{canceled.cancel()};dialog.show()
                filesExecutor.execute{
                    var saved=0;val skipped=mutableListOf<Pair<android.net.Uri,String>>()
                    for((i,uri) in uris.take(500).withIndex()){
                        if(canceled.isCanceled||destroyed)break
                        val name=runCatching{contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{if(it.moveToFirst())it.getString(0) else null}}.getOrNull()?:"照片${i+1}"
                        val result=runCatching{
                            val bytes=contentResolver.openInputStream(uri)?.use{NativePhotoImporter.readBounded(it)}?:error("无法读取")
                            val draft=NativePhotoImporter.decode(name,bytes);canceled.throwIfCanceled()
                            val time=draft.time?:error("缺少拍摄时间")
                            val match=NativePhotoMatching.match(selected,time)?:error("时间未匹配轨迹或跨越断点")
                            val photo=NativePhotoImporter.toWorkspacePhoto(draft,time,doubleArrayOf(match.coordinate.lon,match.coordinate.lat),selected.id,selected.name,match.kind,draft.altitudeMetres?:match.altitude,if(draft.altitudeMetres!=null)"exif" else match.altitudeSource)
                            store.upsert("photos",photo);saved++
                        }
                        if(result.isFailure && !canceled.isCanceled)skipped+=uri to "$name：${result.exceptionOrNull()?.message?:"未匹配"}"
                        handler.post{if(!destroyed)progress.text="${i+1}/${uris.size} · 已保存$saved · 待确认${skipped.size}"}
                    }
                    handler.post{if(!destroyed){dialog.dismiss();refreshPhotos();renderWorkspace();AlertDialog.Builder(this).setTitle("已保存 $saved 张 · 待确认 ${skipped.size} 张")
                        .setMessage(if(skipped.isEmpty())if(canceled.isCanceled)"已停止；已导入照片保留。" else "导入完成" else skipped.joinToString("\n"){it.second}.take(10000))
                        .setPositiveButton("关闭",null).apply{if(skipped.isNotEmpty())setNeutralButton("处理第一张"){_,_->importPhoto(skipped.first().first)}}.show()}}
                }
            }.setNegativeButton("取消",null).show()
    }
}
