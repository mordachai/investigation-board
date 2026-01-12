# GitHub Actions Workflows

## Automatic Release Creation

This repository includes an automated release workflow that triggers whenever you update the version in `module.json`.

### How It Works

1. **Update the version** in `module.json`:
   ```json
   {
     "version": "1.5.0"
   }
   ```

2. **Commit and push** to the `main` branch:
   ```bash
   git add module.json
   git commit -m "v1.5.0"
   git push origin main
   ```

3. **The workflow automatically**:
   - Detects the version change
   - Creates `module.zip` (containing the entire module)
   - Creates a GitHub Release with tag `v1.5.0`
   - Uploads both `module.zip` and `module.json` to the release
   - Generates release notes with installation instructions

### What Gets Packaged

The workflow packages everything EXCEPT:
- `.git/` directory
- `.github/` directory
- `node_modules/`
- `.gitignore`
- `release-temp/` (temporary build directory)
- Old `investigation-board.zip` files

### Release URLs

After the release is created, users can install via:
- **Latest version**: `https://github.com/mordachai/investigation-board/releases/latest/download/module.json`
- **Specific version**: `https://github.com/mordachai/investigation-board/releases/download/v1.5.0/module.json`

### Requirements

- The workflow runs automatically on GitHub
- No additional setup needed (uses `GITHUB_TOKEN` which is provided automatically)
- Make sure the repository has "Write" permissions for workflows (Settings → Actions → General → Workflow permissions)

### Troubleshooting

If the release isn't created:
1. Check the Actions tab on GitHub to see the workflow run
2. Ensure the version actually changed in the commit
3. Verify you pushed to the `main` branch
4. Check that Actions are enabled for your repository
