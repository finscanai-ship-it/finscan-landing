# Releasing a new FinScan.zip

The zip is **not** committed to git or hosted on Netlify — it lives as a
GitHub Release asset (free + unlimited bandwidth). Railway fetches it on
demand via the stable "latest" URL.

## Stable download URL (used by Railway)

```
https://github.com/finscanai-ship-it/finscan-landing/releases/latest/download/FinScan.zip
```

That URL always points to the most recent release — no Railway env var
change needed when shipping a new version.

## To ship a new version

1. **Rebuild the exe** from the FinScan repo root:
   ```
   pyinstaller --noconfirm finscan.spec
   ```

2. **Rebuild FinScan.zip** in `landing/`:
   ```
   cd landing
   python -c "
   import zipfile, os
   files=[('../dist/finscan.exe','FinScan/finscan.exe'),
          ('../dist/run_finscan.bat','FinScan/run_finscan.bat'),
          ('FinScan_Guide.pdf','FinScan/FinScan_Guide.pdf')]
   with zipfile.ZipFile('FinScan.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as zf:
       for s,a in files: zf.write(s,a)
   print('Built:', round(os.path.getsize('FinScan.zip')/1024/1024,1),'MB')
   "
   ```

3. **Create a new GitHub Release**:
   - Go to https://github.com/finscanai-ship-it/finscan-landing/releases/new
   - Tag: `v1.0.1` (bump from previous)
   - Title: same as tag
   - Drag `FinScan.zip` from `landing/` into the assets uploader
   - Click **Publish release**

4. **Done.** Railway's cache expires after 6h. To force-refresh sooner,
   redeploy the Railway service or trigger a download.
